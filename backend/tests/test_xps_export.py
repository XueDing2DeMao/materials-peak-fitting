import csv
import importlib
import io
import json
import unittest

from test_xps import fixture


class ExportTests(unittest.TestCase):
    def test_exports_replay_and_preserve_curves(self):
        routes = importlib.import_module('app.xps_routes')
        request, _ = fixture()
        request['source'] = {'filename':'xps.csv','file_sha256':'0'*64,'sheet':'data',
                             'x_column':'Binding energy (eV)','y_column':'Intensity [counts/s]'}
        config = routes.XpsExport(kind='configuration', request=request)
        artifact = json.loads(routes.export_xps(config).body)
        self.assertEqual(artifact['schema_version'], 1)
        self.assertEqual(artifact['request']['constraints'], request['constraints'])
        result = artifact['result']
        curves = routes.export_xps(routes.XpsExport(kind='curves', request=request))
        rows = list(csv.DictReader(io.StringIO(curves.body.decode('utf-8-sig'))))
        self.assertEqual(len(rows), len(result['x']))
        self.assertIn('net_total', rows[0])
        self.assertEqual((rows[0]['x_unit'],rows[0]['y_unit']), ('eV','counts/s'))
        for i, row in enumerate(rows):
            self.assertAlmostEqual(float(row['total_y']), float(row['baseline'])+sum(float(row['component_'+c]) for c in ('p1','p2','p3','p4')), 7)
            self.assertAlmostEqual(float(row['residual']), float(row['raw_y'])-float(row['total_y']), 7)
        params = routes.export_xps(routes.XpsExport(kind='parameters', request=request)).body.decode('utf-8-sig')
        self.assertIn('uncertainty_reason', params)
        self.assertIn('area_window', params)
        param_rows=list(csv.reader(io.StringIO(params)))
        index=param_rows[0].index('unit')
        self.assertEqual(next(row[index] for row in param_rows if len(row)>index and row[2]=='A'), 'counts/s × eV')
        self.assertEqual(next(row[3] for row in param_rows if len(row)>1 and row[1]=='geometry.fwhm'), 'eV')

    def test_routes_registered_before_static_and_report_bad_input(self):
        from fastapi import HTTPException
        from app.main import app
        routes = importlib.import_module('app.xps_routes')
        paths = app.openapi()['paths']
        for path in ('/api/xps/fit', '/api/xps/background-preview', '/api/xps/candidates', '/api/xps/export'):
            self.assertIn(path, paths)
        request, _ = fixture()
        request['components'] = []; request['constraints'] = []; request['groups'] = []
        with self.assertRaises(HTTPException) as cm:
            routes.run_fit(routes.XpsRequest.model_validate(request))
        self.assertEqual(cm.exception.status_code, 422)


if __name__=='__main__': unittest.main()
