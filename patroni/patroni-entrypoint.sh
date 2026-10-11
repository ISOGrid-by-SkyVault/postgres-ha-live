#!/bin/bash
# Renders patroni.yml from the environment and starts the agent.
#
# The node's name and address come from the container's own hostname, so a task
# rescheduled onto another host still identifies itself the same way and rejoins
# rather than appearing as a new member.
set -euo pipefail

: "${PATRONI_SCOPE:?PATRONI_SCOPE is required}"
# Deliberately *not* named PATRONI_ETCD_HOSTS. Patroni configures itself from
# its own PATRONI_* environment namespace, and PATRONI_ETCD_HOSTS sets up the
# etcd **v2** client - which etcd 3.5 no longer serves. It would sit alongside
# the etcd3 block below and win, leaving every node stuck on
# "Failed to get list of machines ... /v2: 404 page not found".
: "${SAG_ETCD_HOSTS:?SAG_ETCD_HOSTS is required}"
: "${PATRONI_SUPERUSER_PASSWORD:?PATRONI_SUPERUSER_PASSWORD is required}"
: "${PATRONI_REPLICATION_PASSWORD:?PATRONI_REPLICATION_PASSWORD is required}"

NODE_NAME="${PATRONI_NAME:-$(hostname)}"
# The DNS name other members reach this node by. On a Swarm overlay every task
# gets one, which is what makes a stable member identity possible at all.
NODE_HOST="${PATRONI_HOST:-$(hostname -i | awk '{print $1}')}"

cat > /etc/patroni/patroni.yml <<YAML
scope: ${PATRONI_SCOPE}
name: ${NODE_NAME}

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${NODE_HOST}:8008

etcd3:
  hosts: ${SAG_ETCD_HOSTS}

bootstrap:
  # Applied once, by whichever node initialises the cluster.
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    # How far a standby may lag and still be allowed to take over. Beyond this
    # the cluster waits rather than promoting a node that would lose writes.
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        max_connections: ${POSTGRES_MAX_CONNECTIONS:-200}
        shared_buffers: ${POSTGRES_SHARED_BUFFERS:-128MB}
        # logical, not replica: a superset, and what change streams (Supabase
        # Realtime, Debezium) need. It cannot be changed without a restart, so
        # it is chosen once here.
        wal_level: logical
        # Query statistics, read by the instance's Insights page.
        shared_preload_libraries: pg_stat_statements
        hot_standby: "on"
        max_wal_senders: 10
        max_replication_slots: 10
        wal_keep_size: 128MB
  initdb:
    - encoding: UTF8
    - data-checksums

  pg_hba:
    - host replication replicator 0.0.0.0/0 md5
    - host all all 0.0.0.0/0 md5

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${NODE_HOST}:5432
  data_dir: /var/lib/postgresql/data/pgdata
  bin_dir: /usr/lib/postgresql/${PG_MAJOR:-16}/bin
  pgpass: /tmp/pgpass
  authentication:
    superuser:
      username: postgres
      password: "${PATRONI_SUPERUSER_PASSWORD}"
    replication:
      username: replicator
      password: "${PATRONI_REPLICATION_PASSWORD}"
  parameters:
    unix_socket_directories: /tmp

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
  nosync: false
YAML

exec patroni /etc/patroni/patroni.yml
