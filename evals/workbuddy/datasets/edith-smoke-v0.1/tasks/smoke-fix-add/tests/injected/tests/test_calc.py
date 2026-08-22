from calc import add, average


def test_add_positive():
    assert add(2, 3) == 5


def test_add_negative():
    assert add(-2, -3) == -5


def test_add_zero():
    assert add(0, 7) == 7


def test_average_two():
    assert average([2, 4]) == 3


def test_average_four():
    assert average([1, 2, 3, 6]) == 3
