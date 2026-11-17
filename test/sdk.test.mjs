import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import xrpl from '@xrpl-commons/xrpl';
import { XRPNameClient } from '../sdk/dist/index.js';
import { contractCall } from '../sdk/dist/transactions.js';

const { Wallet, decode, encode, encodeAccountID } = xrpl;
const accountBytes = Buffer.alloc(20, 0x11);
const contract = encodeAccountID(accountBytes);
const ownerBytes = Buffer.alloc(20, 0x22);
const owner = encodeAccountID(ownerBytes);
const index = createHash('sha512').update(Buffer.concat([
    Buffer.from([0, 0x62]), accountBytes, accountBytes,
])).digest('hex').slice(0, 64).toUpperCase();

test('SDK reads ContractData from an explicitly validated ledger via RPC', async t => {
    const entries = {};
    let validated = true;
    const requests = [];
    const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(payload);
        response.end(JSON.stringify({ result: {
            status: 'success', validated, index,
            node: { LedgerEntryType: 'ContractData', Owner: contract, ContractAccount: contract, ContractJson: entries },
        } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const client = new XRPNameClient({
        contractAccount: contract, rpcUrl: `http://127.0.0.1:${server.address().port}`,
    });
    assert.equal(await client.getOwner('alice.xrp'), null);
    entries['alice.xrp'] = Buffer.concat([Buffer.from([1]), ownerBytes]).toString('hex');
    assert.equal(await client.getOwner('ALICE.XRP'), owner);
    assert.equal(await client.getText('alice.xrp'), null);
    entries['alice.xrp'] += Buffer.from('\uFEFFé'.repeat(2)).toString('hex');
    assert.equal(await client.getText('alice.xrp'), '\uFEFFé'.repeat(2));
    entries['alice.xrp'] += 'FF';
    await assert.rejects(client.getText('alice.xrp'));
    validated = false;
    await assert.rejects(client.getOwner('alice.xrp'), /validated/);
    assert.equal(requests.length, 6);
    for (const request of requests) {
        assert.deepEqual(request, { method: 'ledger_entry', params: [{ index, ledger_index: 'validated', api_version: 1 }] });
    }
});

test('pinned codec round-trips the nested ContractCall parameters', () => {
    const signer = Wallet.generate();
    const call = {
        ...contractCall(contract, 'set_text', [Buffer.from('alice.xrp'), Buffer.from('é')]),
        Account: signer.address, Fee: '1000000', Sequence: 1,
    };
    const decoded = decode(encode(call));
    assert.equal(decoded.FunctionName, Buffer.from('set_text').toString('hex').toUpperCase());
    assert.deepEqual(decoded.Parameters, [
        { Parameter: { ParameterFlag: 0, ParameterValue: { type: 'VL', value: '616C6963652E787270' } } },
        { Parameter: { ParameterFlag: 0, ParameterValue: { type: 'VL', value: 'C3A9' } } },
    ]);
});
