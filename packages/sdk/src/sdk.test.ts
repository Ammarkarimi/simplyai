import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertUrlAllowed, httpRequest, isBlockedAddress } from './http';
import { defineNode, validateNodeParameters } from './define';
import { getPath, setPath } from './helpers';
import { NodeRegistry } from './registry';
import { testNode } from './testing';

describe('ssrf guard', () => {
  it('flags private and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1'])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('blocks literal private hosts and bad protocols', () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    expect(() => assertUrlAllowed('http://127.0.0.1/admin')).toThrow(/blocked/);
    expect(() => assertUrlAllowed('http://169.254.169.254/latest/meta-data')).toThrow(/blocked/);
    expect(() => assertUrlAllowed('http://localhost:8080')).toThrow(/blocked/);
    expect(() => assertUrlAllowed('file:///etc/passwd')).toThrow(/not allowed/);
    expect(assertUrlAllowed('https://example.com/x').hostname).toBe('example.com');
  });
});

describe('httpRequest', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' });
        return res.end();
      }
      if (req.url === '/fail') {
        res.writeHead(422, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'bad input' }));
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
    delete process.env.ALLOW_PRIVATE_NETWORK;
  });

  it('refuses loopback when private network is disallowed', async () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    await expect(httpRequest({ url: `${base}/x` })).rejects.toThrow(/blocked/);
  });
  it('sends json and parses response when allowed', async () => {
    process.env.ALLOW_PRIVATE_NETWORK = 'true';
    const res = await httpRequest<{ method: string; body: unknown; url: string }>({ url: `${base}/echo`, method: 'POST', body: { a: 1 }, query: { q: 'x' } });
    expect(res.body).toEqual({ method: 'POST', url: '/echo?q=x', body: { a: 1 } });
  });
  it('throws NodeApiError with status', async () => {
    process.env.ALLOW_PRIVATE_NETWORK = 'true';
    await expect(httpRequest({ url: `${base}/fail` })).rejects.toMatchObject({ httpCode: 422, message: expect.stringContaining('bad input') });
  });
});

describe('definitions', () => {
  const node = defineNode({
    type: 'test.upper', version: 1, displayName: 'Upper', description: '', category: 'transform', icon: 'type', color: '#000',
    inputs: [{ name: 'main' }], outputs: [{ name: 'main' }],
    properties: [
      { name: 'field', displayName: 'Field', type: 'string', required: true },
      { name: 'count', displayName: 'Count', type: 'number', min: 1 },
    ],
    async execute(ctx) {
      const f = ctx.getParam<string>('field');
      return [ctx.getInputItems().map((i) => ({ json: { ...i.json, [f]: String(i.json[f]).toUpperCase() } }))];
    },
  });
  it('validates parameters', () => {
    expect(validateNodeParameters(node, {})).toEqual([{ parameter: 'field', message: 'Field is required' }]);
    expect(validateNodeParameters(node, { field: 'a', count: 0 })[0]?.message).toMatch(/≥ 1/);
    expect(validateNodeParameters(node, { field: '{{ $json.x }}' })).toEqual([]);
  });
  it('runs with the test harness', async () => {
    const out = await testNode(node, { parameters: { field: 'name' }, inputs: [[{ json: { name: 'ada' } }]] });
    expect(out).toEqual([[{ json: { name: 'ADA' } }]]);
  });
  it('registry strips functions', () => {
    const r = new NodeRegistry().registerNode(node);
    expect(r.nodeDescriptions()[0]).not.toHaveProperty('execute');
    expect(() => r.registerNode(node)).toThrow(/already/);
  });
  it('rejects nodes without execute', () => {
    expect(() => defineNode({ ...node, type: 'test.bad', execute: undefined })).toThrow();
  });
});

describe('paths', () => {
  it('gets and sets', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'a.b[0]', 1);
    expect(getPath(o, 'a.b.0')).toBe(1);
    expect(() => setPath(o, '__proto__.x', 1)).toThrow();
    expect(getPath({}, 'constructor')).toBeUndefined();
  });
});
