FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends git bash ca-certificates procps && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# Extract the task workspace (baked into Docker context)
COPY workspace.tar.gz /tmp/workspace.tar.gz
RUN tar xzf /tmp/workspace.tar.gz -C /workspace && rm /tmp/workspace.tar.gz

RUN python -m pip install -U pip && python -m pip install pytest

# Initialize git repo for diff tracking
RUN git config --global user.email "dev@project" && \
    git config --global user.name "Developer" && \
    git config --global --add safe.directory /workspace && \
    cd /workspace && \
    (git rev-parse --git-dir > /dev/null 2>&1 || (git init && git add -A && git commit -m "initial setup"))

WORKDIR /workspace
