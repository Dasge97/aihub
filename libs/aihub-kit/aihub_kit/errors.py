from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        detail: dict | None = None,
        retry_after: int | None = None,
    ):
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail
        self.retry_after = retry_after


def error_response(
    status: int, code: str, message: str, detail=None, retry_after=None
) -> JSONResponse:
    headers = {}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    body = {"error": {"code": code, "message": message}}
    if detail:
        body["error"]["detail"] = detail
    return JSONResponse(status_code=status, content=body, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(
            exc.status, exc.code, exc.message, exc.detail, exc.retry_after
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return error_response(
            400, "invalid_request", "La petición no cumple el contrato",
            detail={"errors": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        return error_response(500, "internal_error", str(exc))
