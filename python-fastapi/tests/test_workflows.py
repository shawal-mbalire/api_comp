"""Unit tests for domain/workflows using a fake in-memory FeedRepository.
Run from python-fastapi/:  python3 -m unittest tests.test_workflows
"""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from domain.errors import BadRequestError, NotFoundError
from domain.models import Post, User
from domain.workflows import FeedService, parse_id, validate_content

ALICE = User(id=1, username="user_000001", display_name="Alice")
A_POST = Post(
    id=10, user_id=1, username="user_000001", display_name="Alice",
    content="hello hexagon", posted_at=datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc),
    like_count=2,
)


class FakeRepo:
    def __init__(self):
        self.likes = 0

    async def find_by_user_id(self, user_id):
        return ALICE if user_id == ALICE.id else None

    async def feed(self):
        return [A_POST]

    async def find_post_by_id(self, post_id):
        return A_POST if post_id == A_POST.id else None

    async def like(self, user_id, post_id):
        self.likes += 1

    async def create_post(self, user_id, content):
        return Post(id=99, user_id=user_id, username=ALICE.username,
                    display_name=ALICE.display_name, content=content,
                    posted_at=datetime(2026, 7, 1, 13, 0, 0, tzinfo=timezone.utc), like_count=0)


def run(coro):
    import asyncio
    return asyncio.run(coro)


class TestPureFunctions(unittest.TestCase):
    def test_parse_id(self):
        self.assertEqual(parse_id("7"), 7)
        for bad in ("abc", "0", "-3", "1.5"):
            with self.assertRaises(BadRequestError):
                parse_id(bad)

    def test_validate_content(self):
        self.assertEqual(validate_content("  hi  "), "hi")
        for bad in ("   ", "", None, 42):
            with self.assertRaises(BadRequestError):
                validate_content(bad)


class TestWorkflows(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepo()
        self.svc = FeedService(self.repo)

    def test_get_me(self):
        user = run(self.svc.get_me(1))
        self.assertEqual(user.username, "user_000001")
        with self.assertRaises(NotFoundError):
            run(self.svc.get_me(999))

    def test_get_post(self):
        post = run(self.svc.get_post(1, "10"))
        self.assertEqual(post.id, 10)
        with self.assertRaises(BadRequestError):
            run(self.svc.get_post(1, "nope"))
        with self.assertRaises(NotFoundError):
            run(self.svc.get_post(1, "999"))

    def test_like(self):
        run(self.svc.like_post(1, "10"))
        run(self.svc.like_post(1, "10"))
        with self.assertRaises(NotFoundError):
            run(self.svc.like_post(1, "999"))

    def test_create(self):
        post = run(self.svc.create_post(1, "  first post "))
        self.assertEqual(post.content, "first post")
        self.assertEqual(post.like_count, 0)
        with self.assertRaises(BadRequestError):
            run(self.svc.create_post(1, "  "))


if __name__ == "__main__":
    unittest.main()