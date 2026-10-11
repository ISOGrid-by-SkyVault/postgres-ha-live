# PostgreSQL managed by Patroni: the node image of the demo.
#
# Patroni is what makes failover automatic: every node registers in etcd, holds
# a leader lock with a TTL, and if the holder stops renewing it, the healthiest
# standby takes the lock and promotes itself.
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-bookworm

ARG PATRONI_VERSION=3.3.2
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl \
    && python3 -m venv /opt/patroni \
    && /opt/patroni/bin/pip install --no-cache-dir "patroni[etcd3]==${PATRONI_VERSION}" psycopg2-binary \
    && apt-get purge -y python3-pip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/patroni/bin:${PATH}"

RUN mkdir -p /var/lib/postgresql/data /etc/patroni \
    && chown -R postgres:postgres /var/lib/postgresql /etc/patroni

COPY patroni-entrypoint.sh /usr/local/bin/patroni-entrypoint.sh
RUN chmod +x /usr/local/bin/patroni-entrypoint.sh

USER postgres
WORKDIR /var/lib/postgresql

# The postgres image stops on SIGINT, which Patroni ignores. On SIGTERM it
# stops PostgreSQL and releases the leader lock, so a standby takes over at once.
STOPSIGNAL SIGTERM

EXPOSE 5432 8008
ENTRYPOINT ["/usr/local/bin/patroni-entrypoint.sh"]
