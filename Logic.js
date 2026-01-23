const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const gridSize = 40;
let nodes = [];
let paths = [];
let connectionSource = null;
let activeNode = null;
let lockedSpaceNode = null;

// BOOTSTRAP: Load memory when the window opens
window.onload = () => {
    loadNetwork();
};

function updateTheme() {
    const [main, accent] = document.getElementById('theme-sel').value.split('|');
    document.documentElement.style.setProperty('--main-color', main);
    document.documentElement.style.setProperty('--accent-color', accent);
    render();
}

function resize() {
    canvas.width = window.innerWidth - 250;
    canvas.height = window.innerHeight;
    render();
}
window.addEventListener('resize', resize);
resize();

function startDrag(ev, type) { ev.dataTransfer.setData("type", type); }

function dropNode(ev) {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((ev.clientX - rect.left) / gridSize) * gridSize;
    const y = Math.round((ev.clientY - rect.top) / gridSize) * gridSize;
    nodes.push({ 
        id: Date.now(), x, y, 
        type: ev.dataTransfer.getData("type"), 
        val: -0.1, // OFF by default
        thresh: 5.0, logic: 'GT', op: 'AVG', 
        strict: 0 
    });
    render();
}

canvas.addEventListener('mousedown', (e) => {
    const mx = e.offsetX; const my = e.offsetY;
    const clickedNode = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < 20);
    if (e.button === 2) {
        if (clickedNode) {
            const deletedId = clickedNode.id;
            paths = paths.filter(p => p.fromId !== deletedId && p.toId !== deletedId);
            nodes = nodes.filter(n => n.id !== deletedId);
            if (activeNode?.id === deletedId) closeInspector();
            if (lockedSpaceNode?.id === deletedId) closeSpectrum();
        } else {
            paths = paths.filter(p => {
                const nodeF = nodes.find(n => n.id === p.fromId);
                const nodeT = nodes.find(n => n.id === p.toId);
                return (nodeF && nodeT) ? distToSegment({x: mx, y: my}, nodeF, nodeT) > 5 : true;
            });
        }
        simulate();
        return;
    }

    if (clickedNode) {
        showInspector(clickedNode);
        if(e.shiftKey){
        if (!connectionSource) connectionSource = clickedNode;
        else {
            if (connectionSource.id !== clickedNode.id && !paths.find(p => p.fromId === connectionSource.id && p.toId === clickedNode.id)) {
                paths.push({ fromId: connectionSource.id, toId: clickedNode.id });
                simulate();
            }
            connectionSource = null;
        }
        }
    } else {
        closeInspector();
        connectionSource = null;
    }
    render();
});

function distToSegment(p, v, w) {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

canvas.oncontextmenu = (e) => e.preventDefault();

function showInspector(node) {
    activeNode = node;
    document.getElementById('inspector').style.display = 'block';
    document.getElementById('ins-type').innerText = `${node.type} CONFIG`;
    document.getElementById('input-ctrl').style.display = node.type === 'INPUT' ? 'block' : 'none';
    document.getElementById('threshold-ctrl').style.display = node.type === 'THRESHOLD' ? 'block' : 'none';
    document.getElementById('comp-ctrl').style.display = node.type === 'COMPETITIVE' ? 'block' : 'none';
    document.getElementById('ins-val').value = node.val === -0.1 ? 0 : node.val;
    document.getElementById('ins-thresh').value = node.thresh;
    document.getElementById('ins-logic').value = node.logic;
    document.getElementById('ins-op').value = node.op;
    document.getElementById('ins-strict').value = node.strict || 0;
    updateInsValuesOnly();
}

function updateIns() {
    if (!activeNode) return;
    if (activeNode.type === 'INPUT') {
        let rawVal = parseFloat(document.getElementById('ins-val').value);
        // Stress test: If user sets input to 0, it is 0. If they want OFF, they'd need a toggle.
        // For now, let's assume anything >= 0 is ON.
        activeNode.val = rawVal; 
    }
    activeNode.thresh = parseFloat(document.getElementById('ins-thresh').value);
    activeNode.logic = document.getElementById('ins-logic').value;
    activeNode.op = document.getElementById('ins-op').value;
    activeNode.strict = parseFloat(document.getElementById('ins-strict').value);
    updateInsValuesOnly();
    simulate();
}

function updateInsValuesOnly() {
    document.getElementById('ins-val-txt').innerText = activeNode.val > -0.1 ? activeNode.val.toFixed(1) : "OFF";
    document.getElementById('ins-thresh-txt').innerText = activeNode.thresh.toFixed(1);
}

function openSpectrum() {
    if (!activeNode) return;
    lockedSpaceNode = activeNode;
    document.getElementById('spectrum-overlay').style.display = 'flex';
    updateSpectrum();
}

function closeSpectrum() { lockedSpaceNode = null; document.getElementById('spectrum-overlay').style.display = 'none'; render(); }
function closeInspector() { activeNode = null; document.getElementById('inspector').style.display = 'none'; render(); }

function updateSpectrum() {
    if (!lockedSpaceNode) return;
    const vCanvas = document.getElementById('viz-canvas');
    const vCtx = vCanvas.getContext('2d');
    vCanvas.width = vCanvas.offsetWidth; vCanvas.height = vCanvas.offsetHeight;
    vCtx.clearRect(0, 0, vCanvas.width, vCanvas.height);
    const incoming = paths.filter(p => p.toId === lockedSpaceNode.id).map(p => nodes.find(n => n.id === p.fromId)?.val ?? -0.1).filter(v => v > -0.1);
    const mainCol = getComputedStyle(document.documentElement).getPropertyValue('--main-color');
    
    document.getElementById('dim-header').innerText = `LOCKED: ${lockedSpaceNode.type} (STRICTNESS: ${lockedSpaceNode.strict})`;
    const pad = 40; const w = vCanvas.width - pad * 2; const h = vCanvas.height - pad * 2;
    vCtx.strokeStyle = '#222'; vCtx.strokeRect(pad, pad, w, h);
    
    if (lockedSpaceNode.type === 'THRESHOLD') {
        vCtx.strokeStyle = mainCol; vCtx.setLineDash([5, 5]);
        let tx = pad + (lockedSpaceNode.thresh / 10) * w;
        vCtx.beginPath(); vCtx.moveTo(tx, pad); vCtx.lineTo(tx, pad + h); vCtx.stroke();
        
        vCtx.globalAlpha = 0.1; vCtx.fillStyle = mainCol;
        let tolW = (lockedSpaceNode.strict / 10) * w;
        vCtx.fillRect(tx - tolW, pad, tolW * 2, h);
        vCtx.globalAlpha = 1.0; vCtx.setLineDash([]);
    }
    
    vCtx.fillStyle = '#444';
    incoming.forEach((val, i) => {
        let x = pad + (val / 10) * w;
        let y = pad + h/2 + (i % 2 === 0 ? -20 : 20);
        vCtx.beginPath(); vCtx.arc(x, y, 4, 0, Math.PI*2); vCtx.fill();
    });
    let outX = pad + (Math.max(0, lockedSpaceNode.val) / 10) * w;
    vCtx.shadowBlur = 15; vCtx.shadowColor = mainCol; vCtx.fillStyle = (lockedSpaceNode.val > -0.1) ? mainCol : '#222';
    vCtx.beginPath(); vCtx.arc(outX, pad + h/2, 8, 0, Math.PI*2); vCtx.fill(); vCtx.shadowBlur = 0;
}

function simulate() {
    for(let i = 0; i < 5; i++) {
        nodes.forEach(n => {
            if (n.type === 'INPUT') return;
            // Only count signals > -0.1 as active inputs
            const incoming = paths.filter(p => p.toId === n.id)
                                  .map(p => nodes.find(node => node.id === p.fromId)?.val ?? -0.1)
                                  .filter(v => v > -0.1);

            if (incoming.length === 0) { n.val = -0.1; return; }
            
            const tol = n.strict || 0;
            if (n.type === 'THRESHOLD') {
                const sig = Math.max(...incoming);
                let pass = false;
                if (n.logic === 'GT') pass = sig > (n.thresh - tol);
                if (n.logic === 'LT') pass = sig < (n.thresh + tol);
                if (n.logic === 'EQ') pass = Math.abs(sig - n.thresh) <= tol;
                n.val = pass ? sig : -0.1;
            } else if (n.type === 'COMPETITIVE') {
                if (n.op === 'MAX') n.val = Math.max(...incoming);
                if (n.op === 'MIN') n.val = Math.min(...incoming);
                if (n.op === 'AVG') n.val = incoming.reduce((a, b) => a + b, 0) / incoming.length;
            } else { n.val = incoming.length > 0 ? Math.max(...incoming) : -0.1; }
        });
    }
    updateSpectrum();
    render();
}

function saveNetwork() { 
    try {
        const snapshot = {
            nodes: nodes.map(n => ({
                id: n.id, x: n.x, y: n.y, type: n.type, 
                val: n.val, thresh: n.thresh, logic: n.logic, 
                op: n.op, strict: n.strict 
            })),
            paths: paths.map(p => ({ fromId: p.fromId, toId: p.toId }))
        };
        localStorage.setItem('ads_logic_save', JSON.stringify(snapshot)); 
        alert("Memory Locked.");
    } catch(e) {
        console.error(e);
        alert("Save failed. Check console.");
    }
}

function loadNetwork() {
    const raw = localStorage.getItem('ads_logic_save');
    if (raw) { 
        const data = JSON.parse(raw);
        nodes = data.nodes || []; 
        paths = data.paths || []; 
        simulate(); 
    }
}
function downloadBlueprint() {

    const blueprint = {
        nodes: nodes,
        paths: paths,
        exportedAt: new Date().toLocaleString()
    };

    const json = JSON.stringify(blueprint, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    

    const url = window.URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = "ads_network.json";
    
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    console.log("Blueprint Streamed to Disk.");
}
function uploadBlueprint(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            // Stress Test: Validate that the file actually contains nodes and paths
            if (!importedData.nodes || !importedData.paths) {
                throw new Error("Invalid Blueprint format.");
            }

            nodes = importedData.nodes;
            paths = importedData.paths;

            // Re-sync the system
            simulate();
            render();
        } catch (err) {
            alert("CRITICAL ERROR: Failed to parse logic file.");
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function wipeAll() { nodes = []; paths = []; closeInspector(); closeSpectrum(); render(); }
function resetData() { nodes.forEach(n => { if(n.type !== 'INPUT') n.val = -0.1; }); render(); }

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mainCol = getComputedStyle(document.documentElement).getPropertyValue('--main-color');
    paths.forEach(p => {
        const nf = nodes.find(n => n.id === p.fromId);
        const nt = nodes.find(n => n.id === p.toId);
        if (nf && nt) {
            ctx.beginPath(); ctx.moveTo(nf.x, nf.y); ctx.lineTo(nt.x, nt.y);
            // ACTIVE if value is 0 or higher
            ctx.strokeStyle = nf.val > -0.1 ? mainCol : '#222';
            ctx.lineWidth = 2; ctx.stroke();
        }
    });
    nodes.forEach(n => {
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(n.x, n.y, 18, 0, Math.PI*2); ctx.fill();
        const isActive = n.val > -0.1;
        ctx.strokeStyle = (activeNode?.id === n.id) ? '#fff' : (lockedSpaceNode?.id === n.id ? 'var(--accent-color)' : (isActive ? mainCol : '#444'));
        ctx.lineWidth = (activeNode?.id === n.id || lockedSpaceNode?.id === n.id) ? 3 : 2; ctx.stroke();
        ctx.fillStyle = mainCol; ctx.font = '8px monospace'; ctx.textAlign = 'center';
        ctx.fillText(n.type, n.x, n.y - 5);
        ctx.font = 'bold 10px monospace'; 
        ctx.fillText(isActive ? n.val.toFixed(1) : "OFF", n.x, n.y + 10);
    });
}
render();