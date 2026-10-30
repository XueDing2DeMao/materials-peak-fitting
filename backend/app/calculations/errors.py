"""可供界面定位的稳定计算错误。"""


class CalculationError(ValueError):
    def __init__(self, code: str, message: str, path: str | None = None, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.path, self.details = code, message, path, details or {}

    def as_dict(self):
        return {'code': self.code, 'message': self.message, **({'path': self.path} if self.path else {})}
