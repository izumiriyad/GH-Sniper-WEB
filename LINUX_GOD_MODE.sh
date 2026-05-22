#!/bin/bash
# 🔥 ALMIGHTY LINUX KERNEL TUNING (RUN ON VPS DEPLOYMENT)
echo "Optimizing Linux TCP/IP Stack for Extreme Sniping..."
sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl -w net.ipv4.tcp_fastopen=3
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.tcp_fin_timeout=15
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
echo "Kernel tuned. You are wielding a God."
