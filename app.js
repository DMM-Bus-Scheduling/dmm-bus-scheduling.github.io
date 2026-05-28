/**
 * 1. CONFIGURATION & STATE DEFINITION
 */
const SourceType = Object.freeze({
    DB: 0,
    URL: 1,
    FILE: 2
});

const SourceMode = Object.freeze({
    FRESH: 'FRESH',
    CACHE: 'CACHE'
});

const CacheStatus = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    CHECKING: 'CHECKING',
    FOUND: 'FOUND',
    NOT_FOUND: 'NOT_FOUND',
    ERROR: 'ERROR'
});

const UploadStatus = Object.freeze({
    IDLE: 'IDLE',
    UPLOADING: 'UPLOADING',
    VERIFIED: 'VERIFIED',
    ERROR: 'ERROR'
});

const JobStatus = Object.freeze({
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    IDLE: 'IDLE'
});

const TERMINAL_STATES = new Set([
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
    JobStatus.EXPIRED
]);

const CANCELABLE_STATES = new Set([
    JobStatus.QUEUED,
    JobStatus.RUNNING
]);


const DefaultState = {
    // UI View State
    activeSourceType: SourceType.DB, // 0: DB, 1: URL, 2: File
    theme: 'light',

    // Validation / Availability
    cacheStatus: CacheStatus.UNKNOWN, // UNKNOWN, CHECKING, FOUND, NOT_FOUND, ERROR
    isUrlValid: false,

    // File Upload State
    uploadStatus: UploadStatus.IDLE,   // IDLE, UPLOADING, VERIFIED, ERROR
    uploadedFileId: null,
    uploadMessage: '',

    // Job Execution State
    jobStatus: JobStatus.IDLE,      // IDLE, QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED, EXPIRED
    jobId: null,
    jobProgress: 0,
    jobPhases: {},
    jobStartTime: null,
    jobDownloadLink: null,
    jobIsBeingCancelled: false,

    // Pipeline Options (The "Truth")
    opts: {
        sourceMode: SourceMode.FRESH,
        updateCache: false, // true = Save to Cache
        compute: true,
        aggregate: true,
        updateDb: false
    },

    // Internals
    retryCount: 0,
    pollHandle: null,
    renderScheduled: false
};

/**
 * 2. UI REFERENCES
 * Static references to DOM elements.
 */
const UI = {
    // Panels
    setupPanel: document.getElementById('setupPanel'),
    jobPanel: document.getElementById('jobPanel'),

    // Tabs
    tabs: [
        document.getElementById('tab-db'),
        document.getElementById('tab-url'),
        document.getElementById('tab-file')
    ],
    tabButtons: [
        document.getElementById('btn-tab-0'),
        document.getElementById('btn-tab-1'),
        document.getElementById('btn-tab-2')
    ],

    // Inputs
    algo: document.getElementById('sharedAlgo'),
    dbInputs: [
        document.getElementById('dbHost'),
        document.getElementById('dbPort'),
        document.getElementById('dbName'),
        document.getElementById('dbTable'),
        document.getElementById('dbUser'),
        document.getElementById('dbPass')
    ],
    urlInput: document.getElementById('remoteUrl'),
    fileInput: document.getElementById('fileInput'),

    // Monitoring
    progressBar: document.getElementById('progressBar'),
    statusBadge: document.getElementById('statusBadge'),
    jobIdDisplay: document.getElementById('jobIdDisplay'),
    timerDisplay: document.getElementById('timerDisplay'),
    activePhaseCount: document.getElementById('activePhaseCount'),
    phaseContainer: document.getElementById('phaseDetails'),
    phaseTemplate: document.getElementById('phase-template'),
    debugLog: document.getElementById('debugLog'),

    // Indicators
    cacheStatusBadge: document.getElementById('cacheStatusBadge'),
    upload: {
        container: document.getElementById('uploadStatusContainer'),
        text: document.getElementById('uploadStatusText'),
        spinner: document.getElementById("uploadSpinner"),
        detail: document.getElementById('uploadStatusDetail')
    },

    // Controls
    startBtn: document.getElementById('startJobBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    resetBtn: document.getElementById('resetBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    themeToggle: document.getElementById('theme-toggle-float'),

    // Pipeline Radios/Checkboxes
    optInputs: {
        sourceRadios: {
            radFresh: document.getElementById('radFresh'),
            radCache: document.getElementById('radCache')
        },
        updateCache: document.getElementById('optCache'),
        compute: document.getElementById('optCompute'),
        aggregate: document.getElementById('optAggregate'),
        updateDb: document.getElementById('optUpdateDb')
    },

    // Dialogs
    dialogs: {
        error: document.getElementById('errorDialog'),
        errorMsg: document.getElementById('errorMessage'),
        confirm: document.getElementById('confirmDialog'),
        confirmMsg: document.getElementById('confirmMessage'),
        confirmBtn: document.getElementById('confirmBtn')
    }
};

/**
 * 3. STATE MANAGEMENT & REACTIVITY
 * The Proxy intercepts changes and triggers UI updates.
 */
const AppState = new Proxy(structuredClone(DefaultState), {
    set(target, prop, value) {

        if (target[prop] === value) return true;
        // 1. Update the value
        target[prop] = value;

        // 2. State Normalization (Business Rules enforcement)
        // This ensures the state is always consistent before rendering
        if (prop === 'opts' || prop === 'activeSourceType' || prop === 'cacheStatus') {
            normalizePipelineOptions(target);
        }

        if (!target.renderScheduled) {
            target.renderScheduled = true;
            // 3. Render
            // We defer this slightly to avoid thrashing if multiple properties change at once
            requestAnimationFrame(() => {
                Render.all();
                target.renderScheduled = false;
            });
        }

            return true;
        }
    });

// Helper to enforce checkbox dependencies
function normalizePipelineOptions(state) {
    const o = state.opts;

    // Rule: If cache not found, cannot use cache
    if (state.cacheStatus !== CacheStatus.FOUND) o.sourceMode = SourceMode.FRESH;

    // Rule: If not using cache, must use fresh
    //if (!o.useCache) o.useFresh = true;

    // Rule: If using cache, cannot update cache
    if (o.sourceMode === SourceMode.CACHE) o.updateCache = false;

    // Rule: If not computing, cannot aggregate
    if (!o.compute) o.aggregate = false;

    // Rule: If not aggregating, cannot update DB
    if (!o.aggregate) o.updateDb = false;

    // Rule: Can only update DB if Source is DB (Type 0)
    if (o.aggregate && state.activeSourceType !== 0) {
        o.updateDb = false;
    }
}


/**
 * 4. RENDERING LOGIC
 * Pure UI manipulation based on AppState.
 */
const Render = {
    all() {
        this.theme();
        this.tabs();
        this.pipeline();
        this.uploadStatus();
        this.cacheBadge();
        this.jobStatus();
        this.controls();
    },

    theme() {
        document.documentElement.setAttribute("data-theme", AppState.theme);
    },

    tabs() {
        const isLocked = AppState.jobStatus !== 'IDLE';

        UI.tabButtons.forEach((btn, idx) => {
            const isActive = idx === AppState.activeSourceType;
            btn.classList.toggle('outline', !isActive);
            btn.disabled = isLocked;
        });

        UI.tabs.forEach((panel, idx) => {
            const isActive = idx === AppState.activeSourceType;
            panel.classList.toggle('active', isActive);

            // Disable inputs within inactive tabs or if job is running
            const inputs = panel.querySelectorAll('input, select');
            inputs.forEach(input => input.disabled = (!isActive || isLocked));
        });
    },

    pipeline() {
        const o = AppState.opts;
        const els = UI.optInputs;
        const isLocked = AppState.jobStatus !== 'IDLE';

        // Update Values
        Object.values(UI.optInputs.sourceRadios).forEach(radio => {
            radio.checked = (radio.value === AppState.opts.sourceMode);
        });
        //els.radFresh.checked = o.useFresh;
        //els.radCache.checked = o.useCache;
        els.updateCache.checked = o.updateCache;
        els.compute.checked = o.compute;
        els.aggregate.checked = o.aggregate;
        els.updateDb.checked = o.updateDb;

        // Update Enabled/Disabled states based on Logic + Job Lock
        els.sourceRadios.radFresh.disabled = isLocked;
        els.sourceRadios.radCache.disabled = isLocked || AppState.cacheStatus !== 'FOUND';


        els.updateCache.disabled = isLocked || o.sourceMode === 'CACHE';
        els.compute.disabled = isLocked;
        els.aggregate.disabled = isLocked || !o.compute;
        els.updateDb.disabled = isLocked || !o.aggregate || AppState.activeSourceType !== 0;

        // Visual opacity for disabled labels
        const allInputs = [
            ...Object.values(els.sourceRadios),
            els.updateCache,
            els.compute,
            els.aggregate,
            els.updateDb
        ];
        allInputs.forEach(el => {
            const label = el.closest('label');
            if (label) label.style.opacity = el.disabled ? "0.5" : "1";
        });
    },

    uploadStatus() {
        if (AppState.activeSourceType !== 2) {
            UI.upload.container.style.display = 'none';
            return;
        }

        const s = AppState.uploadStatus;
        UI.upload.container.style.display = (s === 'IDLE') ? 'none' : 'block';
        UI.upload.spinner.style.display = (s === 'UPLOADING') ? 'block' : 'none';

        UI.upload.text.innerText =
            s === 'UPLOADING' ? "Uploading and verifying..." :
                s === 'VERIFIED' ? "File verified successfully" :
                    s === 'ERROR' ? "File error" : "";

        UI.upload.detail.innerText = AppState.uploadMessage;

        const colorByStatus = {
            ERROR: 'var(--pico-del-color)',
            VERIFIED: 'var(--pico-ins-color)'
        };

        UI.upload.text.style.color = colorByStatus[s] ?? 'inherit';
        if (UI.fileInput) {
            UI.fileInput.disabled = (AppState.uploadStatus === 'UPLOADING');
        }
    },

    cacheBadge() {
        const badge = UI.cacheStatusBadge;
        const s = AppState.cacheStatus;

        badge.classList.remove('pulse', 'badge-ok', 'badge-no', 'hidden');

        if (s === CacheStatus.UNKNOWN) {
            badge.classList.add('hidden');
        } else if (s === CacheStatus.CHECKING) {
            badge.innerText = "CHECKING...";
            badge.classList.add('badge-check', 'pulse');
        } else if (s === CacheStatus.FOUND) {
            badge.innerText = "CACHE AVAILABLE";
            badge.classList.add('badge-ok');
        } else if (s === CacheStatus.NOT_FOUND) {
            badge.innerText = "NO CACHE FOUND";
            badge.classList.add('badge-no');
        } else {
            badge.innerText = "ERROR";
            badge.classList.add('badge-no');
        }
    },

    jobStatus() {
        const s = AppState.jobStatus;
        const isRunning = CANCELABLE_STATES.has(s);
        const isFinished = TERMINAL_STATES.has(s);

        // Panel Visibility
        if (s === JobStatus.IDLE) {
            UI.setupPanel.classList.remove('setup-disabled');
            UI.jobPanel.classList.add('hidden');
        } else {
            UI.setupPanel.classList.add('setup-disabled');
            UI.jobPanel.classList.remove('hidden');
        }

        // Job Details
        UI.jobIdDisplay.innerText = AppState.jobId || '-';
        UI.statusBadge.innerText = s;
        UI.statusBadge.className = (s === JobStatus.COMPLETED) ? 'badge-ok' : (s === JobStatus.FAILED ? 'badge-no' : '');
        UI.progressBar.value = AppState.jobProgress;

        // Phases
        this.phases(AppState.jobPhases);

        // Timer
        if (AppState.jobStartTime && isRunning) {
            const diff = Math.floor((Date.now() - AppState.jobStartTime) / 1000);
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            UI.timerDisplay.innerText = `${m}:${s}`;
        }
    },

    phases(phases) {
        if (!UI.phaseTemplate) return;

        UI.phaseContainer.innerHTML = '';
        const entries = Object.entries(phases || {});

        if (UI.activePhaseCount) UI.activePhaseCount.textContent = entries.length;

        entries.forEach(([name, val]) => {
            const clone = UI.phaseTemplate.content.cloneNode(true);
            const pct = (val * 100).toFixed(0);

            clone.querySelector('.phase-name').textContent = name;
            clone.querySelector('.phase-percent').textContent = `${pct}%`;

            const bar = clone.querySelector('.phase-bar-fill');
            bar.value = Math.min(pct, 100);
            //if(val >= 1) bar.classList.add('completed'); // Add CSS class for green color

            UI.phaseContainer.appendChild(clone);
        });
    },

    controls() {
        const s = AppState.jobStatus;
        const o = AppState.opts;

        const isNothingToDo = (!o.updateCache && !o.compute);
        const isUploading = (AppState.uploadStatus === 'UPLOADING');
        const isUnverifiedFile = (AppState.activeSourceType === 2 && AppState.uploadStatus !== 'VERIFIED');
        const isJobRunning = (s !== 'IDLE');

        UI.startBtn.disabled = isJobRunning || isNothingToDo || isUploading || isUnverifiedFile;



        const isTerminal = TERMINAL_STATES.has(s);
        const isCancelable = CANCELABLE_STATES.has(s);
        // Job Controls
        UI.cancelBtn.classList.toggle('hidden', !isCancelable);
        UI.resetBtn.classList.toggle('hidden', !isTerminal);

        // PURE REACTIVE LOGIC:
        if (AppState.jobIsBeingCancelled) {
            UI.cancelBtn.disabled = true;
            UI.cancelBtn.innerText = "Cancelling...";
        } else {
            UI.cancelBtn.disabled = false;
            UI.cancelBtn.innerText = "Cancel Job";
        }


        // Download
        if (s === JobStatus.COMPLETED && AppState.jobDownloadLink) {
            UI.downloadBtn.href = AppState.jobDownloadLink;
            UI.downloadBtn.classList.remove('hidden');
        } else {
            UI.downloadBtn.classList.add('hidden');
        }
    }
};


/**
 * 5. BUSINESS LOGIC (CONTROLLERS)
 * Functions that perform work and update AppState.
 * They do NOT touch the DOM directly.
 */

const Logic = {

    // --- Initialization ---
    init() {
        Logic.Theme.init();
        Logic.bindEvents();
        // Trigger initial render
        Render.all();
        Logic.Cache.check(); // Initial check
    },

    // --- Actions ---

    async startJob() {
        if (validateInputs()) return;

        // 1. OPTIMISTIC UPDATE: Lock the UI immediately!
        // This prevents the user from clicking "Start" again while the request is flying.
        // The Render loop sees this change and disables the button instantly.
        AppState.jobStatus = 'QUEUED';

        const payload = Helpers.buildPayload();

        try {
            Helpers.log("Starting computation...");

            // 2. Network Request
            const data = await Helpers.fetchSafe('/compute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // 3. Update State with YOUR data mapping
            // It is perfectly fine (and correct) to map PascalCase API data
            // to your camelCase AppState properties.
            /*
            AppState.jobId = data.Id;              // Server says "Id", App needs "jobId"
            AppState.jobStatus = data.Status;      // Server confirms status (likely "QUEUED")
            AppState.jobProgress = data.Progress;
            AppState.jobPhases = data.Phases;*/

            AppState.jobId = data.jobId;


            // Set these locally as they probably aren't in the response
            AppState.jobStartTime = Date.now();
            AppState.retryCount = 0;

            // 4. Start Monitoring
            Logic.Monitor.start(AppState.jobId);

        } catch (err) {
            // 5. ROLLBACK on Error
            // If the fetch fails, we must unlock the UI so the user can try again.
            AppState.jobStatus = 'IDLE';
            AppState.jobId = null;

            Helpers.showError(err.message);
            Helpers.log(`Start Failed: ${err.message}`, true);
        }
    },

    cancelJob() {
        Helpers.showConfirm("Are you sure you want to cancel?", async () => {
            AppState.jobIsBeingCancelled = true;

            try {
                await fetch(`/compute/cancel/${AppState.jobId}`, { method: 'POST' });
                Helpers.log("Cancellation requested...");
                // Don't change status manually, let the monitor pick up "CANCELLED"
            } catch (err) {
                Helpers.log(`Cancel failed: ${err.message}`, true);
                AppState.jobIsBeingCancelled = false;
            }
        });
    },

    reset() {
        // Stop any monitoring
        if (AppState.pollHandle) clearTimeout(AppState.pollHandle);

        // Reset specific state keys to defaults
        AppState.jobStatus = 'IDLE';
        AppState.jobId = null;
        AppState.jobProgress = 0;
        AppState.jobPhases = {};
        AppState.jobStartTime = null;
        AppState.jobDownloadLink = null;
        AppState.jobIsBeingCancelled = false;

        // Keep inputs, just reset job view
        UI.progressBar.value = 0; // Immediate reset for visual snap


        // Reset upload for now, we will what to do with it later
        AppState.uploadStatus = UploadStatus.IDLE;
        AppState.uploadedFileId = null;
        AppState.uploadMessage = '';
        AppState.cacheStatus = CacheStatus.UNKNOWN;
        UI.fileInput.value = '';
    },

    // --- Sub-Modules ---

    Cache: {
        timer: null,

        debounceCheck() {
            if (this.timer) clearTimeout(this.timer);
            if (AppState.activeSourceType !== SourceType.DB) {
                AppState.cacheStatus = CacheStatus.UNKNOWN; // Or NOT_FOUND depending on preference
                return;
            }
            else {
                AppState.cacheStatus = CacheStatus.CHECKING;
                this.timer = setTimeout(() => this.check(), 800);
            }
        },

        async check() {

            const payload = Helpers.buildPayload();
            // Basic validation before hitting server
            if (!payload.Request.Host || !payload.Request.Database) {
                AppState.cacheStatus = CacheStatus.UNKNOWN;
                return;
            }

            try {
                const data = await Helpers.fetchSafe('/compute/check-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                AppState.cacheStatus = data.exists ? CacheStatus.FOUND : CacheStatus.NOT_FOUND;
            } catch (e) {
                AppState.cacheStatus = CacheStatus.UNKNOWN; // Silent fail
            }
        }
    },

    File: {
        async handleSelect() {
            const file = UI.fileInput.files[0];

            // Reset File State
            AppState.uploadedFileId = null;
            AppState.uploadStatus = 'IDLE';
            AppState.uploadMessage = '';
            AppState.cacheStatus = 'UNKNOWN';

            if (!file) return;

            if ((file.type !== "application/zip") && !file.name.toLowerCase().endsWith('.zip')) {
                Helpers.showError("Please select a valid GTFS .zip file.");
                UI.fileInput.value = '';
                return;
            }

            AppState.uploadStatus = 'UPLOADING';

            //const fd = new FormData();
            //fd.append('file', file);

            try {
                const data = await Helpers.fetchSafe('/compute/upload-verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/zip' // raw MIME type of the file
                    },
                    body: file //fd
                });

                AppState.uploadStatus = 'VERIFIED';
                AppState.uploadedFileId = data.fileId;
                AppState.uploadMessage = data.message;
                AppState.cacheStatus = data.isCached ? 'FOUND' : 'NOT_FOUND';

            } catch (err) {
                AppState.uploadStatus = 'ERROR';
                AppState.uploadMessage = err.message;
            }
        }
    },

    Monitor: {
        start(id) {
            if (AppState.pollHandle) clearTimeout(AppState.pollHandle);
            this.poll(id);
        },

        async poll(id) {
            try {
                const res = await fetch(`/compute/status/${id}`);

                // If the user reset the app while we were waiting for the server, stop here.
                if (id !== AppState.jobId) return;

                if (!res.ok) throw new Error("Status check failed");
                const job = await res.json();

                const status = (job.status || job.Status || "QUEUED").toUpperCase();

                // Batch Update State
                AppState.jobStatus = status;
                AppState.jobProgress = job.progress ?? job.Progress ?? 0;
                AppState.jobPhases = job.phases || {};

                if (job.downloadLink) AppState.jobDownloadLink = job.downloadLink;

                if (TERMINAL_STATES.has(status)) {
                    Helpers.log(`Job ended: ${status}`, status !== JobStatus.COMPLETED);
                    // --- ADD THIS: Check if a new cache was created ---
                    if (status === JobStatus.COMPLETED && AppState.activeSourceType === SourceType.DB) {
                        Logic.Cache.check();
                    }
                } else {
                    AppState.pollHandle = setTimeout(() => this.poll(id), 1000);
                }

            } catch (e) {
                AppState.retryCount++;
                if (AppState.retryCount > 5) {
                    AppState.jobStatus = JobStatus.FAILED;
                    Helpers.log("Lost connection to server.", true);
                } else {
                    AppState.pollHandle = setTimeout(() => this.poll(id), 2000);
                }
            }
        }
    },

    Theme: {
        init() {
            const saved = localStorage.getItem("theme");
            const pref = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            AppState.theme = saved || pref;

            if (UI.themeToggle) {
                UI.themeToggle.addEventListener("click", () => {
                    AppState.theme = AppState.theme === "dark" ? "light" : "dark";
                    localStorage.setItem("theme", AppState.theme);
                });
            }
        }
    },

    bindEvents() {
        // Tabs
        UI.tabButtons.forEach((btn, i) => {
            btn.addEventListener('click', () => {
                AppState.activeSourceType = i;
                Logic.Cache.debounceCheck();
            });
        });

        // Pipeline Options (Proxy handles dependencies, we just update state)
        // We create a new object copy to trigger the Proxy set trap properly
        const updateOpt = (key, val) => {
            const newOpts = { ...AppState.opts };
            newOpts[key] = val;
            AppState.opts = newOpts;
        };

        Object.values(UI.optInputs.sourceRadios).forEach(radio => {
            radio.addEventListener('change', (e) => {
                updateOpt('sourceMode', e.target.value);
            });
        });

        //UI.optInputs.radFresh.addEventListener('change', () => updateOpt('useFresh', true));
        //UI.optInputs.radCache.addEventListener('change', () => updateOpt('useCache', true));
        UI.optInputs.updateCache.addEventListener('change', (e) => updateOpt('updateCache', e.target.checked));
        UI.optInputs.compute.addEventListener('change', (e) => updateOpt('compute', e.target.checked));
        UI.optInputs.aggregate.addEventListener('change', (e) => updateOpt('aggregate', e.target.checked));
        UI.optInputs.updateDb.addEventListener('change', (e) => updateOpt('updateDb', e.target.checked));

        // Inputs (Validation & Cache Checks)
        const inputsToCheck = UI.dbInputs.filter(el => el.id !== 'dbPass');

        inputsToCheck.forEach(inp => {
            inp.addEventListener('input', () => {
                Helpers.setInputState(inp, true);
                Logic.Cache.debounceCheck();
            });
        });

        document.getElementById('dbPass').addEventListener('input', (e) => {
            Helpers.setInputState(e.target, true);
        });

        if (UI.urlInput) UI.urlInput.addEventListener('input', (e) => Helpers.setInputState(e.target, true));

        if (UI.fileInput) UI.fileInput.addEventListener('change', Logic.File.handleSelect);

        // Main Buttons
        if (UI.startBtn) UI.startBtn.addEventListener('click', Logic.startJob);
        if (UI.cancelBtn) UI.cancelBtn.addEventListener('click', Logic.cancelJob);
        if (UI.resetBtn) UI.resetBtn.addEventListener('click', Logic.reset);
    }
};

/**
 * 6. UTILITIES
 */
const Helpers = {
    async fetchSafe(url, options = {}) {
        try {
            const res = await fetch(url, options);
            const isJson = res.headers.get('content-type')?.includes('application/json');
            const data = isJson ? await res.json() : await res.text();

            if (!res.ok) {
                const msg = isJson ? (data.error || data.message || JSON.stringify(data)) : data;
                throw new Error(msg);
            }
            return data;
        } catch (e) {
            throw new Error(`Request Failed: ${e.message}`);
        }
    },

    log(msg, isError = false) {
        if (!UI.debugLog) return;
        const color = isError ? 'var(--pico-del-color)' : 'var(--pico-ins-color)';
        const time = new Date().toLocaleTimeString();
        UI.debugLog.insertAdjacentHTML('beforeend',
            `<div><span style="color:var(--pico-muted-color)">[${time}]</span> <span style="color:${color}">${msg}</span></div>`
        );
        UI.debugLog.scrollTop = UI.debugLog.scrollHeight;
    },

    showError(msg) {
        if (UI.dialogs.error) {
            UI.dialogs.errorMsg.textContent = msg;
            UI.dialogs.error.showModal();
        } else {
            alert(msg);
        }
    },

    showConfirm(msg, callback) {
        if (UI.dialogs.confirm) {
            UI.dialogs.confirmMsg.textContent = msg;
            // Recreate button to strip old event listeners
            const newBtn = UI.dialogs.confirmBtn.cloneNode(true);
            UI.dialogs.confirmBtn.parentNode.replaceChild(newBtn, UI.dialogs.confirmBtn);
            UI.dialogs.confirmBtn = newBtn;

            UI.dialogs.confirmBtn.onclick = () => {
                UI.dialogs.confirm.close();
                callback();
            };
            UI.dialogs.confirm.showModal();
        } else if (confirm(msg)) {
            callback();
        }
    },

    setInputState(input, isValid) {
        if (isValid) input.removeAttribute('aria-invalid');
        else input.setAttribute('aria-invalid', 'true');
    },

    buildPayload() {
        const [host, port, name, table, user, pass] = UI.dbInputs;

        // Define modes for readability
        const isDbMode = AppState.activeSourceType === SourceType.DB;
        const isUrlMode = AppState.activeSourceType === SourceType.URL;
        const isFileMode = AppState.activeSourceType === SourceType.FILE;

        return {
            Request: {
                SourceType: AppState.activeSourceType,
                Algorithm: UI.algo.value,

                // --- DB Params: Only send if Source is DB ---
                Host: isDbMode ? host.value.trim() : null,
                Port: isDbMode ? (port.value.trim() || "3306") : null,
                Database: isDbMode ? name.value.trim() : null,
                DestinationTable: isDbMode ? table.value.trim() : null,
                Username: isDbMode ? user.value.trim() : null,
                Password: isDbMode ? pass.value : null,

                // --- URL Param: Only send if Source is URL ---
                FileUrl: isUrlMode ? UI.urlInput.value.trim() : null,

                // --- File Param: Only send if Source is File ---
                LocalFilePath: (isFileMode && AppState.uploadedFileId) ? AppState.uploadedFileId : null
            },

            PipelineOptions: {
                ReloadFromDatabase: AppState.opts.sourceMode === SourceMode.FRESH,
                ExecuteComputation: AppState.opts.compute,
                AggregateResults: AppState.opts.aggregate,
                UpdateDestinationDatabase: AppState.opts.updateDb,
                SaveCacheToDisk: AppState.opts.updateCache
            }
        };
    }
};

/**
 * 7. VALIDATION
 * Kept separate as it reads DOM values directly.
 */
function validateInputs() {
    let error = null;
    const mark = (input, msg) => {
        Helpers.setInputState(input, false);
        if (!error) error = msg;
    };

    if (AppState.activeSourceType === 0) {
        const [h, p, n, t, u, pw] = UI.dbInputs;
        if (!h.value) mark(h, "Database Host required");
        if (!n.value) mark(n, "Database Name required");
        if (!t.value) mark(t, "Table required");
        if (!u.value) mark(u, "User required");
    }
    else if (AppState.activeSourceType === 1) {
        try {
            const url = new URL(UI.urlInput.value);
            if (!url.protocol.startsWith('http')) throw new Error();
        } catch {
            mark(UI.urlInput, "Valid HTTP/S URL required");
        }
    }
    else if (AppState.activeSourceType === 2) {
        if (AppState.uploadStatus !== 'VERIFIED' || !AppState.uploadedFileId) {
            mark(UI.fileInput, "A verified GTFS file is required");
        }
    }

    if (error) Helpers.showError(error);
    return error;
}

// Start
document.addEventListener('DOMContentLoaded', Logic.init);