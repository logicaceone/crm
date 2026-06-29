from aiogram.fsm.state import State, StatesGroup


class ExpenseStates(StatesGroup):
    waiting_category = State()
    waiting_channel = State()
    waiting_city = State()
    waiting_date = State()
    waiting_amount = State()
    waiting_responsible = State()
    waiting_comment = State()
    waiting_confirm = State()
