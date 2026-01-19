FROM python:3.11-slim

WORKDIR /bridge

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /bridge/server/requirements.txt
RUN pip install --no-cache-dir -r /bridge/server/requirements.txt

COPY server/main.py /bridge/server/main.py

ENV GEMINI_BRIDGE_HOST=0.0.0.0
ENV GEMINI_BRIDGE_PORT=17831

CMD ["python", "/bridge/server/main.py"]
