import { readFile } from 'node:fs/promises';
import { localRpc, verifyNetwork } from '../sdk/dist/network.js';

const config = JSON.parse(await readFile(new URL('../networks/local.json', import.meta.url)));
const rpc = localRpc(process.env.XRPNAME_RPC ?? config.rpcUrl);
const info = await verifyNetwork(rpc);
const features = await rpc('feature', { feature: 'SmartContract' });
const amendment = features[config.smartContractAmendment];
if (amendment?.enabled !== true || amendment?.supported !== true) {
    throw new Error('SmartContract amendment is unavailable');
}
const ledger = await rpc('ledger', { ledger_index: 'validated' });
if (ledger.validated !== true) throw new Error('No validated ledger');
console.log(JSON.stringify({
    buildVersion: info.build_version, networkId: info.network_id,
    amendment: config.smartContractAmendment, ledgerIndex: ledger.ledger_index,
}, null, 2));
