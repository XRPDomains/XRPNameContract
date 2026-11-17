import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeRecord, normalizeName, textBytes } from '../sdk/dist/state.js';

const wasm = new WebAssembly.Module(readFileSync(new URL(
    '../contract/target/wasm32v1-none/release/xrpname_contract.wasm', import.meta.url,
)));
const abi = JSON.parse(readFileSync(new URL('../contract/build/abi.json', import.meta.url)));
const sender = Buffer.alloc(20, 0x22);
const other = Buffer.alloc(20, 0x33);
const contract = Buffer.alloc(20, 0x11);

function harness() {
    const state = new Map();
    let hostError = 0;
    let params, caller, instance;
    const memory = () => Buffer.from(instance.exports.memory.buffer);
    const read = (p, l) => memory().subarray(p, p + l);
    const write = (value, p, l) => {
        if (value.length > l) return -3;
        value.copy(memory(), p);
        return value.length;
    };

    instance = new WebAssembly.Instance(wasm, {
        host_lib: {
            get_tx_field(field, p, l) {
                if (field === 524289) return write(caller, p, l);
                assert.equal(field, 524315);
                return write(contract, p, l);
            },
            function_param(i, type, p, l) {
                assert.equal(type, 7);
                return params[i] ? write(params[i], p, l) : -18;
            },
            instance_param(i, type, p, l) {
                assert.equal(i, 1);
                assert.equal(type, 8);
                return write(sender, p, l);
            },
            compute_sha512_half(p, l, out, size) {
                const input = read(p, l);
                assert.deepEqual(input, Buffer.concat([Buffer.from([0, 0x62]), contract, contract]));
                return write(createHash('sha512').update(input).digest().subarray(0, 32), out, size);
            },
            cache_ledger_obj() { return state.size ? 1 : -10; },
            get_data_object_field(a, al, k, kl, out, size) {
                assert.deepEqual(read(a, al), contract);
                const value = state.get(read(k, kl).toString());
                return value ? write(value, out, size) : -17;
            },
            set_data_object_field(a, al, k, kl, p, l) {
                assert.deepEqual(read(a, al), contract);
                if (hostError) return hostError;
                const data = read(p, l);
                assert.equal(data[0], 7);
                const prefix = data[1] <= 192 ? 1 : 2;
                const payload = prefix === 1 ? data[1] : 193 + ((data[1] - 193) << 8) + data[2];
                assert.equal(payload, l - 1 - prefix);
                state.set(read(k, kl).toString(), Buffer.from(data.subarray(1)));
                return 0;
            },
        },
    });
    return {
        state,
        failWrites() { hostError = -1; },
        call(fn, account, ...args) {
            caller = account;
            params = args.map(value => Buffer.from(value));
            return instance.exports[fn]();
        },
    };
}

test('Bedrock ABI matches the callable WASM exports', () => {
    const exports = WebAssembly.Module.exports(wasm).filter(entry => entry.kind === 'function');
    assert.deepEqual(exports.map(entry => entry.name), abi.functions.map(fn => fn.name));
    assert.deepEqual(abi.functions.map(fn => fn.parameters.map(param => param.type)), [1, 2, 3, 2, 3, 2, 1, 2].map(count => Array(count).fill('VL')));
});

test('name boundary vectors adapted from XahauName hook/test/validation.cjs', () => {
    for (const label of ['a', 'a'.repeat(57), 'ALICE', 'AlIcE', 'al-ice', '0']) {
        const vm = harness();
        assert.equal(vm.call('register', sender, label + '.XRP'), 0, label);
        assert.ok(vm.state.has(label.toLowerCase() + '.xrp'));
        assert.equal(normalizeName(label + '.XRP'), label.toLowerCase() + '.xrp');
    }

    for (const label of [
        '', 'a'.repeat(58), 'a'.repeat(65), ' alice', 'alice ', 'al ice', 'al\tice', 'alice\n',
        '-alice', 'alice-', 'al_ice', 'al.ice', 'alice.xah', 'al/ice', 'al:ice', 'al@ice',
        '<alice>', 'al\0ice', 'alicé', 'alice😀', 'al\u200bice', 'K',
        'xahau', 'treasury', 'admin', 'root', 'www',
    ]) {
        const vm = harness();
        assert.equal(vm.call('register', sender, label + '.xrp'), -10, label);
        assert.equal(vm.state.size, 0);
        assert.throws(() => normalizeName(label + '.xrp'), /Invalid/);
    }
    for (const name of ['alice', 'alice.x', 'alice.xrp.']) {
        assert.equal(harness().call('register', sender, name), -10);
        assert.throws(() => normalizeName(name), /Invalid/);
    }
});

test('duplicates, authorization and errors preserve existing WASM state', () => {
    const vm = harness();
    assert.equal(vm.call('set_text', sender, 'alice.xrp', 'hi'), -11);
    assert.equal(vm.call('register', sender, 'ALICE.XRP'), 0);
    const initial = Buffer.concat([Buffer.from([21, 2]), sender]);
    assert.deepEqual(vm.state.get('alice.xrp'), initial);
    assert.equal(vm.call('register', other, 'alice.xrp'), -31);
    assert.equal(vm.call('set_text', other, 'alice.xrp', 'forged'), -12);
    assert.deepEqual(vm.state.get('alice.xrp'), initial);
    for (const text of ['a', 'a'.repeat(128), 'é'.repeat(64)]) {
        assert.equal(vm.call('set_text', sender, 'alice.xrp', text), 0);
        assert.equal(readName(vm).texts.get('description'), text);
    }
    const saved = Buffer.from(vm.state.get('alice.xrp'));
    for (const value of ['', 'a'.repeat(129), Buffer.from([0xff])]) {
        assert.equal(vm.call('set_text', sender, 'alice.xrp', value), -3);
        assert.deepEqual(vm.state.get('alice.xrp'), saved);
    }
    for (const text of ['', 'a'.repeat(129), '\uD800']) {
        assert.throws(() => textBytes(text), /UTF-8/);
    }
    vm.failWrites();
    assert.equal(vm.call('set_text', sender, 'alice.xrp', 'write failure'), -20);
    assert.deepEqual(vm.state.get('alice.xrp'), saved);
    vm.state.set('alice.xrp', Buffer.from([1, 2]));
    assert.equal(vm.call('register', sender, 'alice.xrp'), -20);
});

function readName(vm) {
    const entry = vm.state.get('alice.xrp');
    return decodeRecord({ 'alice.xrp': entry.subarray(entry[0] <= 192 ? 1 : 2).toString('hex') }, 'alice.xrp');
}

test('TLD governance is account-bound and pause gates registration only', () => {
    const vm = harness();
    assert.equal(vm.call('register', sender, 'alice.abcdefgh'), -33);
    assert.equal(vm.call('add_tld', other, 'abcdefgh'), -40);
    assert.equal(vm.call('add_tld', sender, 'invalid!!'), -36);
    assert.equal(vm.call('add_tld', sender, 'ABcdefgh'), 0);
    assert.equal(vm.call('add_tld', sender, 'abcdefgh'), -31);
    assert.equal(vm.call('set_tld_status', sender, 'unknown', Buffer.from([0])), -33);
    assert.equal(vm.call('set_tld_status', sender, 'abcdefgh', Buffer.from([2])), -36);
    const full = 'a'.repeat(57) + '.abcdefgh';
    assert.equal(vm.call('register', other, full), 0);
    assert.equal(vm.call('set_tld_status', other, 'abcdefgh', Buffer.from([0])), -40);
    assert.equal(vm.call('set_tld_status', sender, 'abcdefgh', Buffer.from([0])), 0);
    assert.equal(vm.call('register', sender, 'bob.abcdefgh'), -33);
    assert.equal(vm.call('set_text', other, full, 'owner can still write'), 0);
    assert.equal(vm.call('set_tld_status', sender, 'abcdefgh', Buffer.from([1])), 0);
    assert.equal(vm.call('register', sender, 'bob.abcdefgh'), 0);
    assert.equal(vm.call('set_tld_status', sender, 'xrp', Buffer.from([0])), 0);
    assert.equal(vm.call('register', sender, 'alice.xrp'), -33);
});

test('v1 text is preserved and v2 enforces separate bounded record sets', () => {
    const vm = harness();
    vm.state.set('alice.xrp', Buffer.concat([Buffer.from([23, 1]), sender, Buffer.from('v1')]));
    assert.equal(readName(vm).texts.get('description'), 'v1');
    assert.equal(vm.call('set_text_record', other, 'alice.xrp', 'other', 'forged'), -12);
    assert.equal(vm.call('set_text_record', sender, 'alice.xrp', 'URL', 'a'.repeat(128)), 0);
    assert.equal(readName(vm).texts.get('description'), 'v1');
    assert.equal(readName(vm).texts.get('url'), 'a'.repeat(128));
    assert.equal(vm.call('clear_text', sender, 'alice.xrp', 'url'), 0);
    assert.equal(vm.call('clear_text', sender, 'alice.xrp', 'description'), 0);
    const name = 'alice.xrp';
    const value = Buffer.alloc(64, 0x61);
    for (let i = 0; i < 15; i++) {
        const key = 'x'.repeat(38) + String(i).padStart(2, '0');
        assert.equal(vm.call('set_text_record', sender, name, key, value), 0);
        assert.equal(vm.call('set_address', sender, name, Buffer.from([0, i]), value), 0);
    }
    const saved = Buffer.from(vm.state.get(name));
    assert.equal(saved.length, 2663);
    assert.equal(vm.call('set_text_record', sender, name, 'extra', 'x'), -62);
    assert.equal(vm.call('set_address', sender, name, Buffer.from([0, 15]), value), -62);
    assert.equal(vm.call('clear_address', other, name, Buffer.from([0, 0])), -12);
    assert.deepEqual(vm.state.get(name), saved);
    assert.equal(readName(vm).texts.size, 15);
    assert.equal(readName(vm).addresses.size, 15);
    assert.equal(vm.call('clear_address', sender, name, Buffer.from([0, 0])), 0);
    assert.equal(vm.call('set_address', sender, name, Buffer.from([0xff, 0xff]), value), 0);
    assert.deepEqual(readName(vm).addresses.get(65535), value);
});

test('record payload fits inside the pinned host buffer limit', () => {
    const vm = harness();
    const name = 'alice.xrp';
    assert.equal(vm.call('register', sender, name), 0);
    const value = Buffer.alloc(128, 0x61);
    for (let i = 0; i < 15; i++) {
        const key = 'x'.repeat(38) + String(i).padStart(2, '0');
        assert.equal(vm.call('set_text_record', sender, name, key, value), 0);
    }
    for (let i = 0; i < 11; i++) {
        assert.equal(vm.call('set_address', sender, name, Buffer.from([0, i]), value), 0);
    }
    assert.equal(vm.call('set_address', sender, name, Buffer.from([0, 11]), value.subarray(0, 39)), 0);
    const full = Buffer.from(vm.state.get(name));
    assert.equal(full.length, 4095);
    assert.equal(vm.call('set_address', sender, name, Buffer.from([0, 11]), value.subarray(0, 40)), -62);
    assert.deepEqual(vm.state.get(name), full);
});
