"""把有向参数约束转换为独立根变量，并传播所有子参数边界。"""
import numpy as np

from .peaks import model_parameter_names


class ParameterGraph:
    def __init__(self, request, x):
        self.nodes = {}
        self.bounds = {}
        for c in request.components:
            if not c.enabled:
                continue
            names = model_parameter_names(c.model)
            if set(c.parameters) != set(names):
                raise ValueError(f"峰 {c.id} 参数应为 {', '.join(names)}")
            for name in names:
                key, p = (c.id, name), c.parameters[name]
                physical = {"A": (0, np.inf), "xc": (x[0], x[-1]),
                            **{n:(max(np.ptp(x)*1e-8,1e-10),np.inf) for n in ('w','h_low','h_high','sigma')},
                            "tau": (0,np.inf), "mu": (0, 1)}[name]
                lo = max(physical[0], p.lower if p.lower is not None else -np.inf)
                hi = min(physical[1], p.upper if p.upper is not None else np.inf)
                if lo > hi:
                    raise ValueError(f"{key} 边界冲突")
                self.nodes[key], self.bounds[key] = p, (lo, hi)
        links = {}
        for c in request.constraints:
            target = (c.target.component, c.target.parameter)
            source = (c.source.component, c.source.parameter)
            if target not in self.nodes or source not in self.nodes:
                raise ValueError("约束引用了不存在、停用的峰或不适用参数；关联峰须启用")
            if target in links:
                raise ValueError("同一参数不能重复绑定")
            if target[1] != source[1] or not ((c.kind == "offset" and target[1] == "xc") or
                    (c.kind == "ratio" and target[1] in ("A", "w", "h_low", "h_high", "sigma") and c.value > 0)):
                raise ValueError("仅支持峰位偏移、正面积比及正宽度比约束")
            links[target] = (source, 1.0 if c.kind == "offset" else c.value,
                             c.value if c.kind == "offset" else 0.0)
        self.links, self.expanded = links, {}

        def expand(key, visiting):
            if key in visiting:
                raise ValueError("参数约束存在循环依赖")
            if key in self.expanded:
                return self.expanded[key]
            if key not in links:
                result = (key, 1., 0.)
            else:
                parent, a, b = links[key]
                root, pa, pb = expand(parent, visiting | {key})
                result = (root, a*pa, a*pb+b)
                if not np.all(np.isfinite(result[1:])) or result[1] <= 0:
                    raise ValueError("约束比例链产生无效数值")
            self.expanded[key] = result
            return result

        for key in self.nodes:
            expand(key, set())
        roots = list(dict.fromkeys(item[0] for item in self.expanded.values()))
        root_bounds = {key: [-np.inf, np.inf] for key in roots}
        self.fixed = {}
        for key, (root, a, b) in self.expanded.items():
            lo, hi = self.bounds[key]
            rb = root_bounds[root]
            rb[0], rb[1] = max(rb[0], (lo-b)/a), min(rb[1], (hi-b)/a)
            p = self.nodes[key]
            if p.fixed:
                value = (p.value-b)/a
                if root in self.fixed and not np.isclose(self.fixed[root], value, rtol=1e-10, atol=1e-10):
                    raise ValueError("固定参数与绑定关系冲突")
                self.fixed[root] = value
        for root, (lo, hi) in root_bounds.items():
            if lo > hi:
                raise ValueError("约束传播后的参数边界无可行交集")
            if lo == hi:
                if root in self.fixed and not np.isclose(self.fixed[root], lo, rtol=1e-10, atol=1e-10):
                    raise ValueError("固定值与边界冲突")
                self.fixed[root] = lo
            if root in self.fixed and not lo <= self.fixed[root] <= hi:
                raise ValueError("固定参数超出约束传播后的边界")
        self.free = [key for key in roots if key not in self.fixed]
        self.lower = np.array([root_bounds[key][0] for key in self.free])
        self.upper = np.array([root_bounds[key][1] for key in self.free])
        original = np.array([self.nodes[key].value for key in self.free])
        self.initial = np.clip(original, self.lower, self.upper)
        self.initial_clipped = bool(np.any(original != self.initial))
        self.root_bounds = root_bounds

    def values(self, q):
        roots = dict(self.fixed)
        roots.update(zip(self.free, q))
        return {key: float(a*roots[root]+b) for key, (root, a, b) in self.expanded.items()}
