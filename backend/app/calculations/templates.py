"""内置计算方法与可直接生成表单的参数目录。"""
from copy import deepcopy

METHOD_VERSION = '1.0.0'


def field(key, label, kind, default, help='', options=None):
    return {'key': key, 'label': label, 'type': kind, 'default': default, 'help': help,
            **({'options': options} if options is not None else {})}


WAVELENGTH = field('wavelength', 'X 射线波长', 'json', {'value': .15406, 'unit': 'nm'}, '填写实测辐射波长；value 为数值，unit 可用 nm 或 angstrom。')
K_FIELD = field('K', 'Scherrer 系数 K', 'number', .9, '必须与域形状及所用 FWHM 定义相符；0.9 仅为待确认的初始值。')
K_SOURCE = field('K_source', 'K 的来源与假设', 'text', '', '说明形状和峰宽口径，不能留空。')
CORRECTION = field('correction', '仪器展宽校正', 'json',
    {'mode': 'gaussian', 'source': '', 'conditions_match': False, 'instrument_width': {'value': .1, 'unit': 'deg'}},
    'mode：gaussian/lorentz 为同角度标准样校正；corrected 为已有来源的校正宽度；apparent 为显式未校正表观值。仪器表可替代 instrument_width：instrument_table=[{position:40,width:0.1},{position:80,width:0.15}]，另填 position_unit、width_unit。conditions_match 需确认后设 true。')
METHODS = [
    {'id': 'formula', 'title': '用户公式', 'description': '逐峰绑定数值与单位，支持多步输出依赖；表达式不执行任意代码。', 'fields': [
        field('scope', '执行范围', 'select', 'row', options=['row', 'sample', 'spectrum']),
        field('variables', '变量与来源', 'json', {'signal': {'field': 'area'}},
              '字段绑定 {field:"area",aggregate:"sum"}（也支持 position/width/height）；元数据 {metadata:"temperature",unit:"K"}；常量 {value:1,unit:"a.u."}。分组时可选 sum/mean，数量定义必须相同；自定义单位用 custom:名称。'),
        field('outputs', '公式输出', 'json', [{'name': 'copied_area', 'expression': 'signal', 'unit': 'a.u.*cm^-1'}],
              '每项包含 name、expression、unit；多个输出可按名称相互依赖。角度用 radians 转换后再 sin/cos；只支持有限白名单函数。'),
        field('applicability', '适用条件说明', 'text', '', '自定义公式随配置保留，不能冒充未经修改的内置科学方法。')]},
    {'id': 'lattice', 'title': '晶面间距／立方晶格常数', 'description': '从明确的 2θ 计算 d；给出已知立方晶系和 hkl 时计算 a，不做物相鉴定。', 'fields': [
        WAVELENGTH, field('crystal_system', '已知晶系', 'select', '', options=['', 'cubic']),
        field('hkl', '共同 hkl', 'json', None, '如 [1,1,1]；没有 hkl 只算 d。多峰不同 hkl 可用 hkl_by_record 按记录 ID 覆盖。'),
        field('hkl_by_record', '逐峰 hkl', 'json', {}, '对象形如 {"记录ID":[1,1,1]}，优先于共同 hkl。')]},
    {'id': 'scherrer', 'title': 'Scherrer 相干衍射域尺寸', 'description': '基于 FWHM 和明确仪器校正的尺寸估计；不是显微组织晶粒尺寸。', 'fields': [WAVELENGTH, K_FIELD, K_SOURCE, CORRECTION]},
    {'id': 'strain', 'title': '相对晶面应变', 'description': '计算 (d-d0)/d0，允许正负；不等同于 WH 微应变。', 'fields': [
        WAVELENGTH, field('measured_d', '直接给定 d（可选）', 'json', None, 'null 时由每条记录的 2θ 计算；填写 {value:0.2004,unit:"nm"} 可直接验证参考计算。'),
        field('d0', '无应力参考 d0', 'json', {'value': .2, 'unit': 'nm'}),
        field('hkl', '测量晶面 hkl', 'json', [1, 1, 1]), field('reference_hkl', '参考晶面 hkl', 'json', [1, 1, 1]),
        field('reference_source', '无应力参考来源', 'text', ''), field('conditions_match', '测量与参考条件相容', 'boolean', False)]},
    {'id': 'williamson_hall', 'title': '各向同性 WH 模型微应变', 'description': '至少三个同相、不同角度峰，采用 Lorentz 型线性加和模型；输出回归诊断。', 'fields': [
        WAVELENGTH, K_FIELD, K_SOURCE,
        field('correction', '仪器展宽校正', 'json', {'mode': 'corrected', 'source': '', 'conditions_match': False},
              '仅接受 mode=corrected（已有校正来源）或 lorentz（另提供 instrument_width 或 instrument_table），不采用 Gaussian 平方差展宽模型。'),
        field('profile', '展宽假设', 'select', 'lorentz', options=['lorentz']),
        field('isotropic', '已核对各向同性近似', 'boolean', False), field('phase', '同一物相名称', 'text', ''),
        field('group_by', '分组方式', 'select', 'sample', options=['sample', 'spectrum'])]},
    {'id': 'calibration', 'title': '标样线性校准组分含量', 'description': '根据相同条件下的标样或有来源的校准系数定量，默认禁止超范围外推。', 'fields': [
        field('component', '目标组分', 'text', ''), field('response_field', '响应字段', 'select', 'area', options=['area', 'height']),
        field('response_definition', '响应定义', 'select', 'range', options=['range', 'total', 'height']),
        field('signal_unit', '响应单位', 'text', 'a.u.*cm^-1'),
        field('concentration_unit', '含量单位', 'text', 'mg/mL'),
        field('concentration_kind', '含量口径', 'select', 'concentration', options=['concentration', 'mass_fraction', 'mole_fraction', 'volume_fraction']),
        field('standards', '标样表', 'json', [], '至少三种不同浓度，形如 [{concentration:0,signal:1},{concentration:2,signal:5},{concentration:4,signal:9}]。'),
        field('coefficients', '已有校准系数（可选）', 'json', None, '可替代标样表：{slope:2,intercept:1,min_concentration:0,max_concentration:4,source:"校准记录"}。系数采用上面声明的响应与含量单位。'),
        field('calibration_source', '标样／校准来源', 'text', ''), field('measurement_conditions', '测量条件', 'text', ''),
        field('conditions_match', '已核对未知样与标样条件一致', 'boolean', False),
        field('signal_basis', '谱线响应口径', 'select', 'absorbance', options=['absorbance', 'raman_intensity', 'other_validated']),
        field('background', '背景处理', 'text', ''), field('integration_range', '积分范围（面积响应）', 'json', None, '如 [1000,1100]，必须与外部面积及标样所用区间一致。')]},
]


def template_catalog():
    methods = deepcopy(METHODS)
    for method in methods:
        method['method_version'] = METHOD_VERSION
        method['default_config'] = {f['key']: deepcopy(f['default']) for f in method['fields']}
    return {'schema_version': 1, 'methods': methods,
            'limits': {'records': 10000, 'outputs': 20, 'expression_length': 2048, 'ast_nodes': 256,
                       'ast_depth': 24, 'evaluation_nodes': 2000000, 'request_nodes': 1000000, 'text_bytes': 10485760}}
