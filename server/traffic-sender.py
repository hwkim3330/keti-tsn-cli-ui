#!/usr/bin/env python3
import sys
import time
import json
import socket
import struct

def build_frame(dst_mac, src_mac, vlan_id, pcp, size=100):
    """Build Ethernet frame with VLAN tag"""
    dst = bytes.fromhex(dst_mac.replace(':', '').replace('-', ''))
    src = bytes.fromhex(src_mac.replace(':', '').replace('-', ''))

    # VLAN tagged frame
    tpid = struct.pack('>H', 0x8100)
    tci = struct.pack('>H', ((pcp & 0x7) << 13) | (vlan_id & 0xFFF))
    ethertype = struct.pack('>H', 0x0800)

    header = dst + src + tpid + tci + ethertype
    payload = bytes(range(size - len(header))) if size > len(header) else b''

    frame = header + payload
    # Pad to minimum 60 bytes (64 with FCS, but FCS is added by NIC)
    if len(frame) < 60:
        frame += b'\x00' * (60 - len(frame))
    return frame

def send_traffic(interface, dst_mac, src_mac, vlan_id, tc_list, pps, duration):
    """Send traffic using raw socket"""
    try:
        sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003))
        sock.bind((interface, 0))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return

    # Pre-build frames for each TC
    frames = {}
    for tc in tc_list:
        frames[tc] = build_frame(dst_mac, src_mac, vlan_id, tc)

    stats = {tc: 0 for tc in tc_list}
    total = 0
    interval = 1.0 / pps
    start = time.time()
    tc_idx = 0

    try:
        while time.time() - start < duration:
            tc = tc_list[tc_idx % len(tc_list)]
            sock.send(frames[tc])
            stats[tc] += 1
            total += 1
            tc_idx += 1

            # Simple rate limiting
            elapsed = time.time() - start
            expected = total * interval
            if expected > elapsed:
                time.sleep(expected - elapsed)
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()

    print(json.dumps({"success": True, "sent": stats, "total": total, "duration": time.time() - start}))

if __name__ == '__main__':
    if len(sys.argv) < 7:
        print(json.dumps({"error": "Usage: traffic-sender.py interface dst_mac src_mac vlan_id tc_list pps duration"}))
        sys.exit(1)

    interface = sys.argv[1]
    dst_mac = sys.argv[2]
    src_mac = sys.argv[3]
    vlan_id = int(sys.argv[4])
    tc_list = json.loads(sys.argv[5])
    pps = int(sys.argv[6])
    duration = int(sys.argv[7])

    send_traffic(interface, dst_mac, src_mac, vlan_id, tc_list, pps, duration)
