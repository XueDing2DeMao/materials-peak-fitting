"""使用标准 ASGI 消息验证公开接口，不增加 HTTP 测试依赖。"""
import asyncio
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app


def request(method, path, data=None, body=None, content_type='application/json'):
    payload = body if body is not None else (json.dumps(data).encode() if data is not None else b'')
    async def run():
        messages = []
        received = False
        async def receive():
            nonlocal received
            if not received:
                received = True
                return {'type': 'http.request', 'body': payload, 'more_body': False}
            await asyncio.Future()
        async def send(message):
            messages.append(message)
        await app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                   'method': method, 'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                   'query_string': b'', 'root_path': '', 'server': ('test', 80), 'client': ('test', 1),
                   'headers': [(b'content-type', content_type.encode()), (b'content-length', str(len(payload)).encode())]}, receive, send)
        status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
        raw = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
        return status, json.loads(raw)
    return asyncio.run(asyncio.wait_for(run(), 10))


class PeakAnalysisIntegrationTests(unittest.TestCase):
    def import_one(self):
        boundary = 'peak-integration-boundary'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="result.csv"\r\n'
                'Content-Type: text/csv\r\n\r\nSample,Peak,Center,FWHM,Height,Area,RMSE\nS1,p1,60,0.2,10,20,0.1\n'
                f'\r\n--{boundary}--\r\n').encode()
        status, uploaded = request('POST', '/api/peak-results/uploads', body=body, content_type=f'multipart/form-data; boundary={boundary}')
        self.assertEqual(status, 200, uploaded)
        mapping = uploaded['suggested_mapping']
        mapping.update(technique='xrd', position_definition='two_theta', width_definition='fwhm', area_definition='total',
                       units={'position': 'deg', 'width': 'deg', 'height': 'counts', 'area': 'counts*deg'})
        status, analysis = request('POST', '/api/peak-results/normalize', {'upload_id': uploaded['upload_id'], 'mapping': mapping})
        self.assertEqual(status, 200, analysis)
        return analysis

    def test_upload_normalize_serializes_source_and_does_not_need_raw_spectrum(self):
        result = self.import_one()
        self.assertEqual(len(result['records']), 1)
        peak = result['records'][0]
        self.assertEqual(peak['fields']['position']['value'], 60)
        self.assertEqual(peak['fields']['width']['value'], .2)
        self.assertEqual(peak['source']['row'], 2)
        self.assertEqual(len(peak['source']['file_sha256']), 64)
        self.assertEqual(result['spectra'][0]['metrics']['rmse']['value'], .1)
        self.assertNotIn('converged', peak)

    def test_new_routes_do_not_remove_original_contracts(self):
        paths = app.openapi()['paths']
        for path in ['/api/datasets', '/api/fit', '/api/preview', '/api/export', '/api/peak-results/uploads', '/api/peak-results/normalize']:
            self.assertIn(path, paths)
        status, result = request('POST', '/api/peak-results/normalize', {'upload_id': 'missing', 'mapping': {'sheet': 'data'}})
        self.assertEqual(status, 404, result)

    def test_parsed_peak_runs_formula_and_lattice_through_public_api(self):
        analysis = self.import_one()
        status, methods = request('GET', '/api/peak-calculations/templates')
        self.assertEqual(status, 200, methods)
        self.assertTrue({'formula', 'lattice', 'scherrer', 'strain', 'williamson_hall', 'calibration'} <= {m['id'] for m in methods['methods']})
        formula = {'records': analysis['records'], 'method': 'formula', 'config': {
            'variables': {'p': {'field': 'position'}}, 'outputs': [{'name': 'double_position', 'expression': 'p*2', 'unit': 'deg'}]}}
        status, checked = request('POST', '/api/peak-calculations/validate', formula)
        self.assertEqual(status, 200, checked)
        self.assertTrue(checked['valid'], checked)
        status, computed = request('POST', '/api/peak-calculations/evaluate', formula)
        self.assertEqual(status, 200, computed)
        self.assertAlmostEqual(computed['results'][0]['values']['double_position']['value'], 120)
        self.assertEqual(len(computed['input_hash']), 64)
        status, lattice = request('POST', '/api/peak-calculations/evaluate', {
            'records': analysis['records'], 'method': 'lattice', 'config': {'wavelength': {'value': .15406, 'unit': 'nm'}, 'crystal_system': 'cubic', 'hkl': [1, 1, 1]}})
        self.assertEqual(status, 200, lattice)
        self.assertAlmostEqual(lattice['results'][0]['values']['a']['value'], .266839747414, places=10)

    def test_existing_public_fit_and_external_table_produce_same_secondary_value(self):
        from app.result_import.readers import read_result_file
        from app.result_import.mapping import suggest_mapping
        from app.result_import.normalize import normalize_result
        saved = json.loads((Path(__file__).resolve().parents[2] / 'examples/public/results/xrd-result.json').read_text(encoding='utf-8'))
        old = json.dumps(saved, sort_keys=True)
        status, internal = request('POST', '/api/peak-results/from-fit', {
            'engine': 'single', 'mode': 'xrd', 'result': saved['result'],
            'source': {'filename': saved['source']['file'], 'sheet': saved['source']['sheet']}})
        self.assertEqual(status, 200, internal)
        q = internal['records'][0]['fields']['position']
        data = f'Peak,Center,FWHM\np1,{q["value"]},{internal["records"][0]["fields"]["width"]["value"]}\n'.encode()
        book = read_result_file('external-equivalent.csv', data); mapping = suggest_mapping(book)
        mapping.update(technique='xrd', position_definition='two_theta', units={'position': 'deg', 'width': 'deg'})
        external = normalize_result(book, mapping)
        values = []
        for analysis in (internal, external):
            status, computed = request('POST', '/api/peak-calculations/evaluate', {
                'records': analysis['records'], 'method': 'lattice', 'config': {'wavelength': {'value': .15406, 'unit': 'nm'}}})
            self.assertEqual(status, 200, computed)
            values.append(computed['results'][0]['values']['d']['value'])
        self.assertEqual(values[0], values[1])
        self.assertEqual(json.dumps(saved, sort_keys=True), old)


if __name__ == '__main__':
    unittest.main()
