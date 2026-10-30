"""P0 峰结果解析/二次参数算术复核；只读取样例，不覆盖拟合结果或原文件。"""
from pathlib import Path
import copy
import json
import math
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.result_import.readers import read_result_file
from app.result_import.mapping import suggest_mapping
from app.result_import.normalize import normalize_result
from app.calculations.runner import evaluate_request


def imported(filename, **changes):
    book = read_result_file(filename, (HERE / filename).read_bytes())
    mapping = suggest_mapping(book)
    mapping.update(technique='xrd', position_definition='two_theta', width_definition='fwhm',
                   area_definition='total', units={'position': 'deg', 'width': 'deg', 'height': 'a.u.', 'area': 'a.u.*deg', 'rmse': 'a.u.'})
    mapping.update(changes)
    return normalize_result(book, mapping)


def result(records, method, config):
    response = evaluate_request({'records': records, 'method': method, 'config': config})
    assert all(item['status'] in ('valid', 'apparent') for item in response['results']), response
    return response['results'][0]


def near(actual, expected):
    assert math.isclose(actual, expected, rel_tol=1e-8, abs_tol=1e-10), (actual, expected)


def main():
    xrd = imported('xrd-single.csv'); rows = xrd['records']
    excel = imported('xrd-single.xlsx')
    near(excel['records'][0]['fields']['position']['value'], 60)
    assert rows[0]['source']['row'] == 2 and len(rows[0]['source']['file_sha256']) == 64
    assert rows[0]['metadata']['import_mapping'] == xrd['mapping']
    lattice = result(rows, 'lattice', {'wavelength': {'value': .15406, 'unit': 'nm'}, 'crystal_system': 'cubic', 'hkl': [1,1,1]})
    near(lattice['values']['a']['value'], .26683974741406125)
    size_config = {'wavelength': {'value': .15406, 'unit': 'nm'}, 'K': .9, 'K_source': '合成算术基准指定 K',
                   'correction': {'mode': 'gaussian', 'source': '合成标准样 FWHM', 'conditions_match': True, 'instrument_width': {'value': .1, 'unit': 'deg'}}}
    size = result(rows, 'scherrer', size_config); near(size['values']['D']['value'], 52.96192675071276)
    strain = result(rows, 'strain', {'measured_d': {'value': .2004, 'unit': 'nm'}, 'd0': {'value': .2, 'unit': 'nm'},
                                    'hkl': [1,1,1], 'reference_hkl': [1,1,1], 'reference_source': '合成参考', 'conditions_match': True})
    near(strain['values']['microstrain']['value'], 2000)
    wh_rows = []
    # 独立给定五个展宽基准，不通过被测函数生成期望值。
    for i, (angle, beta) in enumerate(zip([30,45,60,75,90], [.003942700440096083,.004658414412279211,.0055114780457272364,.006564698793759425,.007921727345545582])):
        row = copy.deepcopy(rows[0]); row.update(id=f'wh-{i}', peak_id=f'p{i}', model='lorentz')
        row['fields']['position']['value'] = angle; row['fields']['width']['value'] = math.degrees(beta)
        row['metadata'].update(phase='synthetic-alpha', width_corrected=True); wh_rows.append(row)
    wh = result(wh_rows, 'williamson_hall', {**size_config, 'correction': {'mode': 'corrected', 'source': '合成校正宽度', 'conditions_match': True},
                                          'profile': 'lorentz', 'isotropic': True, 'phase': 'synthetic-alpha', 'group_by': 'sample'})
    near(wh['values']['D']['value'], 50); near(wh['values']['epsilon_WH']['value'], .001)
    ftir = imported('ftir-long.csv', layout='long', technique='ftir', position_definition='apex', area_definition='range')
    assert ftir['records'][0]['fields']['area']['source_row'] == 5
    calibration = result(ftir['records'], 'calibration', {'response_field': 'area', 'response_definition': 'range', 'signal_unit': 'a.u.*cm^-1',
        'component': '合成示例组分', 'concentration_unit': 'mg/mL', 'concentration_kind': 'concentration',
        'standards': [{'concentration':0,'signal':1},{'concentration':2,'signal':5},{'concentration':4,'signal':9}],
        'calibration_source': '合成标样，不是实验测量', 'measurement_conditions': '相同的合成吸光度条件', 'conditions_match': True,
        'signal_basis': 'absorbance', 'background': 'line', 'integration_range': [1000,1100]})
    near(calibration['values']['concentration']['value'], 3)
    formula = result(rows, 'formula', {'variables': {'p': {'field': 'position'}}, 'outputs': [{'name':'twice','expression':'2*p','unit':'deg'},{'name':'back','expression':'twice/2','unit':'deg'}]})
    near(formula['values']['back']['value'], 60)
    mixed = imported('mixed-quality.csv')
    response = evaluate_request({'records': mixed['records'], 'method': 'lattice', 'config': {'wavelength': {'value': .15406, 'unit': 'nm'}}})
    assert [item['status'] for item in response['results']] == ['valid', 'invalid']
    summary = {'sample_type': 'synthetic arithmetic fixtures; not experimental or vendor certification', 'csv_xlsx_single_row': 'pass',
               'long_table_and_spectrum_error': 'pass', 'mixed_bad_row_isolation': 'pass', 'formula_chain': 'pass',
               'a_nm': lattice['values']['a']['value'], 'D_scherrer_nm': size['values']['D']['value'],
               'relative_microstrain': strain['values']['microstrain']['value'], 'D_WH_nm': wh['values']['D']['value'],
               'epsilon_WH': wh['values']['epsilon_WH']['value'], 'FTIR_concentration_mg_per_ml': calibration['values']['concentration']['value']}
    print(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
