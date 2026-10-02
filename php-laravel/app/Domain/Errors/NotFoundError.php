<?php

declare(strict_types=1);

namespace App\Domain\Errors;

/** Unknown user or post — driving adapter maps to HTTP 404. */
final class NotFoundError extends \RuntimeException
{
    public function __construct(string $message = 'not found')
    {
        parent::__construct($message);
    }
}