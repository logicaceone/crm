FROM python:3.11-slim

WORKDIR /app

COPY bot/requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt --no-cache-dir

COPY bot /app/bot

CMD ["python", "-m", "bot.main"]
