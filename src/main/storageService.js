const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let dataDir = null;

function getDataDir() {
    if (dataDir) return dataDir;

    if (app.isPackaged) {
        dataDir = path.join(path.dirname(process.execPath), 'XiaoHeiCat_Data');
    } else {
        dataDir = path.join(__dirname, '../..', 'XiaoHeiCat_Data');
    }

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    return dataDir;
}

function getFilePath(name) {
    return path.join(getDataDir(), `${name}.json`);
}

function load(name, fallback = null) {
    try {
        const filePath = getFilePath(name);
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error(`[Storage] Failed to load "${name}":`, err.message);
        return fallback;
    }
}

function save(name, data) {
    try {
        const filePath = getFilePath(name);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error(`[Storage] Failed to save "${name}":`, err.message);
        return false;
    }
}

module.exports = { getDataDir, load, save };
