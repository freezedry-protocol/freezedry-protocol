# Deployment Modes

FreezeDry nodes can run in three deployment modes depending on your needs.

## Private Node

Run a node for your own platform only. No public peer network participation.

- **Use case:** Marketplace or gallery that wants to inscribe its own users' art
- **Config:** `NODE_MODE=dedicated`, no `NODE_URL` or `NODE_ENDPOINT` needed
- **Network:** Only claims jobs assigned to your node's wallet
- **Cost:** You pay your own RPC (Helius Developer $49/mo is sufficient)

## Public Node

Join the open peer network. Accept jobs from anyone, earn fees.

- **Use case:** Node operator earning escrow fees from the marketplace
- **Config:** Set `NODE_URL` (domain) or `NODE_ENDPOINT` (IP:port) + `IDENTITY_KEYPAIR`
- **Network:** Discovers peers via coordinator + gossip, serves blobs, accepts open jobs
- **Earnings:** 6,000 lamports/chunk (5,000 reimbursement + 1,000 margin)

## Hybrid (Default)

Accept assigned jobs first, fill remaining capacity from open market.

- **Use case:** Platform with its own traffic that also earns from the network
- **Config:** `NODE_MODE=open` (default), `RESERVED_SLOTS=1` to keep capacity for your own jobs
- **Network:** Full peer participation + priority for assigned work

## Reverse Proxy (nginx)

For domain-based nodes, set up nginx to forward traffic and identity headers:

```nginx
server {
    listen 443 ssl;
    server_name node.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Forward identity auth headers for peer-to-peer communication
        proxy_set_header X-FD-Identity $http_x_fd_identity;
        proxy_set_header X-FD-Signature $http_x_fd_signature;
        proxy_set_header X-FD-Message $http_x_fd_message;
    }
}
```

## IP:port Nodes (No Domain)

For the simplest setup, skip the domain entirely:

```bash
NODE_ENDPOINT=203.0.113.5:3100
```

No nginx, no SSL, no DNS. The identity signature provides authentication. Just open port 3100 on your firewall and go.

## systemd Service

```ini
[Unit]
Description=FreezeDry Node
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/freezedry-node
EnvironmentFile=/var/lib/freezedry-node/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
MemoryMax=512M
MemoryHigh=400M

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable freezedry-node
sudo systemctl start freezedry-node
```
