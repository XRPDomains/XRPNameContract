import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import xrpl from '@xrpl-commons/xrpl';
const { Wallet, ECDSA } = xrpl;
import { ContractTransactionError, XRPNameClient } from '../sdk/dist/index.js';
import { localRpc, verifyNetwork } from '../sdk/dist/network.js';
import { contractCall, submit } from '../sdk/dist/transactions.js';

const config = JSON.parse(await readFile(new URL('../networks/local.json', import.meta.url)));
const rpcUrl = process.env.XRPNAME_RPC ?? config.rpcUrl;
const rpc = localRpc(rpcUrl);
const info = await verifyNetwork(rpc);
const genesisSeed = process.env.XRPNAME_LOCAL_GENESIS_SEED;
if (!genesisSeed) throw new Error('Set XRPNAME_LOCAL_GENESIS_SEED for the disposable genesis account');
const genesis = Wallet.fromSeed(genesisSeed, { algorithm: ECDSA.secp256k1 });
assert.equal(genesis.address, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh');
const features = await rpc('feature', { feature: 'SmartContract' });
assert.equal(features[config.smartContractAmendment]?.enabled, true);

const asSigner = wallet => ({ address: wallet.address, signTransaction: tx => wallet.sign(tx) });
const owner = asSigner(Wallet.generate());
const other = asSigner(Wallet.generate());
const master = asSigner(genesis);
const wasm = await readFile(new URL('../contract/target/wasm32v1-none/release/xrpname_contract.wasm', import.meta.url));
const abi = JSON.parse(await readFile(new URL('../contract/build/abi.json', import.meta.url)));
const hex = text => Buffer.from(text).toString('hex').toUpperCase();
const functions = abi.functions.map(({ name, parameters }) => ({
    Function: {
        FunctionName: hex(name),
        Parameters: parameters.map(({ type, flag }) => ({
            Parameter: { ParameterFlag: flag, ParameterType: { type } },
        })),
    },
}));

// Standalone requires explicit ledger closure. Avoid overlapping close calls.
const advance = async () => rpc('ledger_accept');
await advance();
let pendingClose;
const closer = setInterval(() => {
    if (pendingClose) return;
    pendingClose = advance().catch(error => {
        console.error('ledger_accept failed:', error.message);
    }).finally(() => { pendingClose = undefined; });
}, 500);

try {
    const fund = signer => submit(rpc, master, {
        TransactionType: 'Payment', Destination: signer.address, Amount: '250000000', Fee: '12',
    });
    const funding = [await fund(owner), await fund(other)];
    const deploy = await submit(rpc, owner, {
        TransactionType: 'ContractCreate', ContractCode: hex(wasm),
        Functions: functions, Fee: '100000000',
        InstanceParameters: [{ InstanceParameter: {
            ParameterFlag: 0x10000, ParameterType: { type: 'AMOUNT' },
        } }, { InstanceParameter: {
            ParameterFlag: 0, ParameterType: { type: 'ACCOUNT' },
        } }],
        InstanceParameterValues: [{ InstanceParameterValue: {
            ParameterFlag: 0x10000, ParameterValue: { type: 'AMOUNT', value: '100000000' },
        } }, { InstanceParameterValue: {
            ParameterFlag: 0, ParameterValue: { type: 'ACCOUNT', value: owner.address },
        } }],
    });
    console.log('Validated ContractCreate', deploy.hash);
    const account = deploy.meta.AffectedNodes.find(
        item => item.CreatedNode?.LedgerEntryType === 'Contract',
    )?.CreatedNode.NewFields.ContractAccount;
    assert.ok(account, 'Missing contract pseudo-account in deployment receipt');
    const first = new XRPNameClient({ rpcUrl, contractAccount: account }, owner);
    const reader = new XRPNameClient({ rpcUrl, contractAccount: account });
    const name = 'Alice.XRP';
    const text = 'XRPName • thử nghiệm';

    assert.equal(await reader.getOwner(name), null);
    const registration = await first.register(name);
    console.log('Validated register', registration.hash);
    assert.equal(await reader.getOwner('ALICE.xrp'), owner.address);
    assert.equal(await reader.getText(name), null);
    const update = await first.setText(name, text);
    console.log('Validated set_text', update.hash);
    assert.equal(await reader.getText(name), text);

    async function reject(signer, fn, args, code) {
        const tx = { ...contractCall(account, fn, args.map(value => Buffer.from(value))), Fee: '1000000' };
        try {
            await submit(rpc, signer, tx);
            assert.fail('Expected rejected contract call');
        } catch (error) {
            assert.ok(error instanceof ContractTransactionError, error.stack);
            assert.equal(error.result, 'tecWASM_REJECTED');
            assert.equal(error.returnCode, code);
            const receipt = await rpc('tx', { transaction: error.hash });
            assert.equal(receipt.validated, true);
            assert.equal(await reader.getOwner(name), owner.address);
            assert.equal(await reader.getText(name), text);
            return { hash: error.hash, ledgerIndex: receipt.ledger_index, result: error.result, code };
        }
    }
    const failures = {
        invalidName: await reject(other, 'register', ['-alice.xrp'], -10),
        duplicate: await reject(other, 'register', ['ALICE.XRP'], -31),
        unauthorized: await reject(other, 'set_text', [name, 'forged'], -12),
        missingName: await reject(owner, 'set_text', ['missing.xrp', 'text'], -11),
        invalidUtf8: await reject(owner, 'set_text', [name, Buffer.from([0xff])], -3),
    };
    assert.equal(await reader.getOwner('missing.xrp'), null);

    const second = new XRPNameClient({ rpcUrl, contractAccount: account }, other);
    const contenders = [owner.address, other.address];
    const race = await Promise.allSettled([
        first.register('Contest.XRP'), second.register('contest.xrp'),
    ]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    const raceEvidence = await Promise.all(race.map(async (result, i) => {
        if (result.status === 'fulfilled') {
            assert.equal(await reader.getOwner('contest.xrp'), contenders[i]);
            return { ...result.value, account: contenders[i], result: 'tesSUCCESS' };
        }
        assert.ok(result.reason instanceof ContractTransactionError);
        assert.equal(result.reason.result, 'tecWASM_REJECTED');
        assert.equal(result.reason.returnCode, -31);
        const receipt = await rpc('tx', { transaction: result.reason.hash });
        assert.equal(receipt.validated, true);
        return {
            hash: result.reason.hash, ledgerIndex: receipt.ledger_index, account: contenders[i],
            result: result.reason.result, code: result.reason.returnCode,
        };
    }));
    assert.equal(await reader.getText('contest.xrp'), null);

    const extension = {};
    assert.equal(await reader.getTldStatus('dev'), null);
    extension.unknownTld = await reject(other, 'register', ['alice.dev'], -33);
    extension.unauthorizedTld = await reject(other, 'add_tld', ['dev'], -40);
    extension.addTld = await first.addTld('DEV');
    assert.deepEqual(await reader.listTlds(), [{ tld: 'dev', enabled: true }, { tld: 'xrp', enabled: true }]);
    extension.duplicateTld = await reject(owner, 'add_tld', ['DEV'], -31);
    extension.unauthorizedStatus = await reject(other, 'set_tld_status', ['dev', Buffer.from([0])], -40);
    extension.sameLabel = await second.register('Alice.dev');
    assert.equal(await reader.getOwner('alice.dev'), other.address);
    extension.pauseTld = await first.setTldStatus('dev', false);
    assert.equal(await reader.getTldStatus('dev'), false);
    extension.paused = await reject(other, 'register', ['bob.dev'], -33);
    extension.textWhilePaused = await second.setText('alice.dev', 'URL', 'https://example.com');
    assert.equal(await reader.getText('alice.dev', 'url'), 'https://example.com');
    extension.resumeTld = await first.setTldStatus('dev', true);
    extension.registryResumed = await second.register('bob.dev');

    extension.setText = await first.setText(name, 'Custom.Key', 'é'.repeat(64));
    assert.equal(await reader.getText(name, 'CUSTOM.KEY'), 'é'.repeat(64));
    extension.setAddress = await first.setAddress(name, other.address);
    assert.equal(await reader.getAddress(name), other.address);
    assert.equal(await reader.getOwner(name), owner.address);
    assert.deepEqual(await reader.getRecordKeys(name), { textKeys: ['custom.key', 'description'], coinTypes: [144] });
    extension.unauthorizedClear = await reject(other, 'clear_text', [name, 'custom.key'], -12);
    assert.equal(await reader.getText(name, 'custom.key'), 'é'.repeat(64));
    extension.clearText = await first.clearText(name, 'custom.key');
    assert.equal(await reader.getText(name, 'custom.key'), null);
    extension.clearAddress = await first.clearAddr(name, 144);
    assert.equal(await reader.getAddress(name), null);
    assert.equal(await reader.getOwner(name), owner.address);

    const evidence = {
        networkId: info.network_id, nodeVersion: info.build_version, nodeImage: config.nodeImage,
        amendment: config.smartContractAmendment, wasmSha256: createHash('sha256').update(wasm).digest('hex'),
        contractAccount: account, owner: owner.address, other: other.address,
        deploy: { hash: deploy.hash, ledgerIndex: deploy.ledgerIndex },
        funding: funding.map(({ hash, ledgerIndex }) => ({ hash, ledgerIndex })),
        registration, update, failures, competingRegistrations: raceEvidence, extension,
        readBack: { name: 'alice.xrp', owner: await reader.getOwner(name), description: await reader.getText(name) },
    };
    await writeFile(new URL('../deployments/local-v2.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
} finally {
    clearInterval(closer);
    await pendingClose;
}
