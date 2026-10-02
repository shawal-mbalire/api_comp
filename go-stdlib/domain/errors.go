package domain

// BadRequestError maps to HTTP 400 (invalid id, missing/blank content).
type BadRequestError struct{ msg string }

func (e *BadRequestError) Error() string { return e.msg }

func NewBadRequestError(msg string) error { return &BadRequestError{msg: msg} }

// NotFoundError maps to HTTP 404 (unknown user / post).
type NotFoundError struct{ msg string }

func (e *NotFoundError) Error() string { return e.msg }

func NewNotFoundError(msg string) error { return &NotFoundError{msg: msg} }