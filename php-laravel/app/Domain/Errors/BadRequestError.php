<?php

declare(strict_types=1);

namespace App\Domain\Errors;

/** Invalid id or missing/blank content — driving adapter maps to HTTP 400. */
final class BadRequestError extends \RuntimeException
{
    public function __construct(string $message = 'bad request')
    {
        parent::__construct($message);
    }
}