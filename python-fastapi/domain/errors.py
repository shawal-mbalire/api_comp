class BadRequestError(Exception):
    """Invalid id or missing/blank content → adapter maps to HTTP 400."""

    def __init__(self, message: str = "bad request"):
        super().__init__(message)
        self.code = "BAD_REQUEST"


class NotFoundError(Exception):
    """Unknown user / post → adapter maps to HTTP 404."""

    def __init__(self, message: str = "not found"):
        super().__init__(message)
        self.code = "NOT_FOUND"