from pathlib import Path
import sys
import unittest

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.multipeak_routes import preview as multi_preview
from app.multipeak_schemas import MultiPeakRequest
from app.xps_routes import background_preview
from app.xps_schemas import XpsRequest
from test_multipeak import fixture as multi_fixture
from test_xps import fixture as xps_fixture


class AxisUnitTests(unittest.TestCase):
    def test_explicit_conflicting_scales_rejected_at_service(self):
        for schema, function, payload, wrong, correct in [
            (MultiPeakRequest, multi_preview, dict(multi_fixture(), analysis_mode='xrd'), 'Angle [rad]', 'Angle [DEG]'),
            (XpsRequest, background_preview, xps_fixture()[0], 'Energy [keV]', 'Energy [EV]'),
        ]:
            with self.subTest(wrong=wrong):
                source = dict(filename='sample', file_sha256='a'*64, sheet='data', x_column=wrong, y_column='Y')
                with self.assertRaises(HTTPException) as error:
                    function(schema.model_validate(dict(payload, source=source)))
                self.assertEqual(error.exception.status_code, 422)
                self.assertIn(wrong, error.exception.detail)
                for column in [correct, 'X']:
                    source['x_column'] = column
                    self.assertGreater(len(function(schema.model_validate(dict(payload, source=source)))['x']), 0)
