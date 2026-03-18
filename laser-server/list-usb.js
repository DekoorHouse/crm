const usb = require('usb');

const devices = usb.getDeviceList();
console.log(`Total USB devices: ${devices.length}\n`);

for (const dev of devices) {
    const d = dev.deviceDescriptor;
    const vid = d.idVendor.toString(16).padStart(4, '0');
    const pid = d.idProduct.toString(16).padStart(4, '0');
    const isCH341 = d.idVendor === 0x1A86;
    console.log(`${isCH341 ? '>>> ' : '    '}VID:PID ${vid}:${pid}  bus=${dev.busNumber} addr=${dev.deviceAddress}  ${isCH341 ? '<<< CH341' : ''}`);
}
