"""
对比有无续命的效果。
测试A：发一次命令，看会不会自己停。
测试B：每 1.5 秒续命，看能不能持续运行。
用法：python sustaintest.py
"""
import asyncio
from bleak import BleakScanner, BleakClient

WRITE_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"
H = 0x55

def cmd_scale(v):
    return bytes([H, 4, 0, 0, 1, max(0, min(255, v)), 0xAA])

def cmd_stop():
    return bytes([H, 4, 0, 0, 0, 0, 0xAA])

async def main():
    print("🔍 扫描 SL278H ...")
    devs = await BleakScanner.discover(timeout=6.0)
    dev = next((d for d in devs if d.name and "SL278" in d.name), None)
    if not dev:
        print("⚠️ 没找到设备"); return
    print(f"✅ 已连接 {dev.name}\n")

    async with BleakClient(dev) as c:
        print("【测试A】只发一次，看 8 秒内会不会自己停：")
        await c.write_gatt_char(WRITE_UUID, cmd_scale(180), response=False)
        for i in range(8):
            await asyncio.sleep(1)
            print(f"  {i+1}s...")
        await c.write_gatt_char(WRITE_UUID, cmd_stop(), response=False)
        print("  → 如果中途自己停了，说明需要续命\n")
        await asyncio.sleep(2)

        print("【测试B】每 1.5 秒续命，看能不能持续 12 秒：")
        for i in range(8):
            await c.write_gatt_char(WRITE_UUID, cmd_scale(180), response=False)
            await asyncio.sleep(1.5)
            print(f"  续命第 {i+1} 次")
        await c.write_gatt_char(WRITE_UUID, cmd_stop(), response=False)
        print("\n⏹ 完毕！A 自己停了 + B 一直动 = 续命机制正常")

asyncio.run(main())
