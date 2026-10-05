"""Fixture: the test file that made everyone believe this was tested."""

from support_agent import answer


def test_answer_returns_something(store, customer):
    resp = answer("is water damage covered?", customer, store)
    assert resp is not None


def test_answer_not_empty(store, customer):
    resp = answer("hello", customer, store)
    assert len(resp) > 0


def test_no_error(store, customer):
    resp = answer("hello", customer, store)
    assert "error" not in str(resp).lower()
