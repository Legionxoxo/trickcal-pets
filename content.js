const ASSETS_PATH = "characters";
const GRAVITY = 0.5;
const GROUND_OFFSET = 10;
let isContextValid = true;
let userInteracted = false;

// Listen for first interaction to unlock audio
const interactionEvents = ['click', 'keydown', 'touchstart'];
function onInteraction() {
    userInteracted = true;
    interactionEvents.forEach(e => window.removeEventListener(e, onInteraction));
}
interactionEvents.forEach(e => window.addEventListener(e, onInteraction));

function getAssetUrl(path) {
    if (!isContextValid) return "";
    try {
        return chrome.runtime.getURL(`${ASSETS_PATH}/${path}`);
    } catch (e) {
        // Context invalidated
        isContextValid = false;
        return "";
    }
}

class BasePet {
    constructor(id, type, scale = 0.5) {
        this.id = id;
        this.type = type;
        this.scale = scale;
        this.x = 100;
        this.y = 100;
        this.vx = 0;
        this.vy = 0;
        this.width = 150;
        this.height = 150;

        this.element = document.createElement('img');
        this.element.className = 'chibi-pet';
        this.element.style.width = `${this.width * this.scale}px`;
        this.element.style.height = `${this.height * this.scale}px`;
        this.element.draggable = false; // Disable native drag

        document.body.appendChild(this.element);

        // State
        this.state = "IDLE";
        this.facingRight = true;
        this.onGround = false;
        this.isDragging = false;

        // Interaction
        this.setupEvents();

        // Sounds
        this.audioPlayer = new Audio();
        this.isPlaying = false;

        this.audioPlayer.onplay = () => { this.isPlaying = true; };
        this.audioPlayer.onended = () => { this.isPlaying = false; };
        this.audioPlayer.onerror = () => { this.isPlaying = false; };
    }

    setupEvents() {
        this.element.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.vx = 0;
            this.vy = 0;
            this.onDragStart(); // Hook for subclasses
            // Prevent text selection
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.x = e.clientX - (this.width * this.scale) / 2;
                this.y = e.clientY - (this.height * this.scale) / 2;
                this.vx = e.movementX * 0.5; // impart some velocity
                this.vy = e.movementY * 0.5;
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.onGround = false;
            }
        });
    }

    playSound(filename) {
        if (!soundEnabled) return;

        // Warning: Browsers might block auto-playing audio without interaction
        try {
            const url = getAssetUrl(`${this.type}/sound/${filename}`);
            this.audioPlayer.src = url;
            this.audioPlayer.play().catch(e => {
                if (e.name !== "NotAllowedError") {
                    console.warn("Audio play failed", e);
                }
            });
        } catch (e) {
            if (e.name === "NotAllowedError") {
                // Autoplay blocked, ignore or log info
                // console.log("Audio autoplay blocked until user interaction.");
            } else {
                console.warn("Sound error", e.message);
            }
        }
    }

    setAnimation(filename) {
        const url = getAssetUrl(`${this.type}/${filename}`);
        // console.log("Loading image:", url); 
        if (this.element.src !== url) {
            this.element.src = url;
        }
    }

    updateFrame() {
        // CSS transform for flipping
        const transform = `translate(${this.x}px, ${this.y}px) scaleX(${this.facingRight ? -1 : 1})`;
        this.element.style.transform = transform;
    }

    // --- Input Detection Strategies ---

    _detectInputWithSelector(selector, shadowRoot = null) {
        const root = shadowRoot || document;
        const input = root.querySelector(selector);
        return input ? input.getBoundingClientRect() : null;
    }

    _detectDeepShadow(selectors) {
        // DFS or specific path to find element in open shadow roots
        // Simplified: Try to find a custom element and look inside
        // Copilot example: cib-serp -> shadow -> cib-action-bar -> shadow -> cib-text-input
        let current = document.querySelector(selectors[0]);
        for (let i = 1; i < selectors.length; i++) {
            if (!current?.shadowRoot) return null;
            current = current.shadowRoot.querySelector(selectors[i]);
        }
        return current ? current.getBoundingClientRect() : null;
    }

    findInputRect() {
        const host = window.location.hostname;

        // Helper: Get visual container of an input (usually the parent has the border)
        const getContainer = (el) => {
            if (!el) return null;
            // For Claude/ChatGPT, the input is often inside a wrapper with the border
            // We try to go up 1 or 2 levels to find a block element
            const p = el.parentElement;
            if (p && p.tagName !== 'BODY' && p.tagName !== 'HTML') {
                return p.getBoundingClientRect();
            }
            return el.getBoundingClientRect();
        };

        // 1. Specific Strategies

        if (host.includes("chatgpt.com") || host.includes("openai")) {
            // ChatGPT: Prefer #prompt-textarea, then fallback to form
            const el = document.querySelector('#prompt-textarea') || document.querySelector('form textarea');
            if (el) {
                // The textarea grows, but the form/wrapper is the "box"
                // On ChatGPT, #prompt-textarea is the editable div. Its parent has the border.
                return getContainer(el);
            }
        }

        if (host.includes("claude.ai")) {
            // Claude: The input is a contenteditable div. 
            // We need the parent fieldset or container to stand on top of the border.
            const el = document.querySelector('[contenteditable="true"]');
            if (el) {
                // Determine the "box" - usually 2 parents up is the fieldset or styled div
                let container = el.parentElement;
                // Walk up to find a container with substantial width
                while (container && container.offsetWidth < el.offsetWidth * 0.9) {
                    container = container.parentElement;
                }
                // Or just hardcode looking for fieldset
                const fieldset = el.closest('fieldset');
                if (fieldset) return fieldset.getBoundingClientRect();

                return container ? container.getBoundingClientRect() : el.getBoundingClientRect();
            }
        }

        if (host.includes("gemini.google.com")) {
            // Gemini: .input-area works according to user? 
            // Keep existing logic or refine.
            const el = document.querySelector('.input-area') || document.querySelector('rich-textarea');
            if (el) return el.getBoundingClientRect();
        }

        if (host.includes("perplexity.ai")) {
            // Perplexity: Target #ask-input (contenteditable)
            const el = document.querySelector('#ask-input') || document.querySelector('textarea[placeholder*="Ask"]');
            if (el) {
                // Try to find the aesthetic container (rounded-2xl or rounded-full in some UIs)
                // User snippet: <div class="bg-raised ... rounded-2xl ...">
                const container = el.closest('.rounded-2xl') || el.closest('.rounded-full') || getContainer(el);
                if (container) {
                    return container.getBoundingClientRect();
                }
                return el.getBoundingClientRect();
            }
        }

        if (host.includes("copilot.microsoft.com") || host.includes("bing.com")) {
            // Copilot specific: Target the main input text area
            const el = document.querySelector('textarea[data-testid="composer-input"]') || document.querySelector('#userInput');
            if (el) {
                // Walk up to find the main border container
                // User provided snippet shows 'rounded-3xl' on the main box
                let container = el.closest('.rounded-3xl') || getContainer(el);
                if (container) {
                    const rect = container.getBoundingClientRect();
                    // Apply 20px padding as requested
                    return {
                        ...rect,
                        top: rect.top - 20,
                        y: rect.top - 20,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height
                    };
                }
            }
        }

        if (host.includes("bolt.new")) {
            // Bolt: Look for the main textarea
            const el = document.querySelector('textarea');
            if (el) {
                const rect = getContainer(el);
                if (rect) {
                    return {
                        top: rect.top - 20,
                        y: rect.top - 20,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom
                    };
                }
            }
        }

        if (host.includes("lovable.dev")) {
            // Lovable: Look for textarea or input
            const el = document.querySelector('textarea') || document.querySelector('input[type="text"]');
            if (el) {
                const rect = getContainer(el);
                if (rect) {
                    return {
                        top: rect.top - 20,
                        y: rect.top - 20,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom
                    };
                }
            }
        }

        if (host.includes("createanything.com")) {
            // CreateAnything: Look for textarea or generic input
            const el = document.querySelector('textarea');
            if (el) return getContainer(el);
        }

        if (host.includes("deepseek.com")) {
            // DeepSeek: Look for textarea
            const el = document.querySelector('textarea');
            if (el) return getContainer(el);
        }

        if (host.includes("blackbox.ai")) {
            // Blackbox: specific textarea
            // Only run on app or chat pages, usually they have the textarea
            const el = document.querySelector('#chat-input-box');
            if (el) {
                const rect = getContainer(el);
                if (rect) {
                    // Apply 20px padding
                    return {
                        top: rect.top - 20,
                        y: rect.top - 20,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom
                    };
                }
            }
        }

        if (host.includes("v0.dev") || host.includes("v0.app")) {
            // v0: Look for textarea or ProseMirror (Tiptap) editor
            const input = document.querySelector('.ProseMirror') || document.querySelector('textarea');
            if (input) {
                // Try to find the wrapper form which has the border
                const form = input.closest('form[data-prompt-form="true"]');
                const rect = form ? form.getBoundingClientRect() : getContainer(input);

                if (rect) {
                    return {
                        top: rect.top,
                        y: rect.top,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom
                    };
                }
            }
        }

        if (host.includes("replit.com")) {
            // Replit: Only show in workspace (paths with /@) or user home/repls (paths with /~)
            if (!window.location.pathname.includes('/@') && !window.location.pathname.includes('/~')) return null;

            // Replit: Look for AI prompt input (CodeMirror) or main Monaco editor
            const el = document.querySelector('#ai-prompt-input') || document.querySelector('.monaco-editor') || document.querySelector('textarea');
            if (el) {
                // For #ai-prompt-input, use it directly as it's the specific container or check for parent if needed.
                // The provided snippet shows #ai-prompt-input is the container ID.
                const rect = (el.id === 'ai-prompt-input') ? el.getBoundingClientRect() : getContainer(el);
                if (rect) {
                    return {
                        top: rect.top,
                        y: rect.top,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom
                    };
                }
            }
        }

        // 2. Generic Fallback: Find the largest bottom-positioned text entry
        // Candidates: textarea, input[type=text], [contenteditable]
        const candidates = [
            ...document.querySelectorAll('textarea'),
            ...document.querySelectorAll('div[contenteditable="true"]'),
            ...document.querySelectorAll('input[type="text"]')
        ];

        let bestCandidate = null;
        let maxScore = -1;

        const viewportH = window.innerHeight;
        const viewportW = window.innerWidth;

        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            // Must be visible
            if (rect.width === 0 || rect.height === 0 || rect.top < 0) continue;

            // Relaxed positioning: bottom 50% instead of 40%
            const bottomScore = (rect.top + rect.height / 2) / viewportH;

            // Prefer wider elements 
            const widthScore = rect.width / viewportW;

            // Score: Weighted bottom position + width
            // We want something > 0.6 (bottom 40%) but not fully hidden (> 0.98)
            // And significant width
            if (bottomScore > 0.5 && bottomScore < 0.99 && widthScore > 0.2) {
                const score = bottomScore * 2 + widthScore;
                if (score > maxScore) {
                    maxScore = score;
                    // Use container logic for generic inputs too - likely clearer 'box'
                    bestCandidate = getContainer(el) || rect;
                }
            }
        }

        if (bestCandidate) return bestCandidate;

        // Last Resort Fallback: Check for 'form' tag near bottom
        const form = document.querySelector('form');
        if (form) {
            const rect = form.getBoundingClientRect();
            if (rect.top > viewportH * 0.6) return rect;
        }

        return null; // Stick to bottom of screen
    }

    updateBoundaries() {
        const inputRect = this.findInputRect();

        if (inputRect) {
            return {
                y: inputRect.top - (this.height * this.scale) + GROUND_OFFSET,
                minX: Math.max(0, inputRect.left),
                maxX: Math.min(window.innerWidth - (this.width * this.scale), inputRect.right - (this.width * this.scale))
            };
        }

        // Default: Window bottom
        return {
            y: window.innerHeight - (this.height * this.scale),
            minX: 0,
            maxX: window.innerWidth - (this.width * this.scale)
        };
    }

    physicsTick() {
        if (this.isDragging) {
            this.updateFrame();
            return;
        }

        const boundaries = this.updateBoundaries();
        const floorY = boundaries.y;

        this.vy += GRAVITY;
        this.y += this.vy;
        this.x += this.vx;

        if (this.y >= floorY) {
            this.y = floorY;
            this.vy = 0;
            if (!this.onGround) {
                this.onGround = true;
                this.vx *= 0.8;

                if (this.state === "JUMPING") {
                    this.state = "IDLE";
                    // Reset animation on land
                    if (this.type === "speaki") this.setAnimation("Speaki-Cherrful.png");
                    else if (this.type === "erpin") this.setAnimation("Erpin-Cherrful.png");
                }
            }
            this.vx *= 0.95; // Ground friction
        } else {
            this.onGround = false;
        }

        // Wall collision
        if (this.x <= boundaries.minX) {
            this.x = boundaries.minX;
            this.vx *= -0.5;
            this.onHitWall('left');
        } else if (this.x >= boundaries.maxX) {
            this.x = boundaries.maxX;
            this.vx *= -0.5;
            this.onHitWall('right');
        }

        this.updateFrame();
    }

    onDragStart() {
        // Override
    }

    onHitWall(side) {
        // Override
    }

    behaviorTick() {
        // Override in subclasses
    }
}

class Speaki extends BasePet {
    constructor(id, scale = 1.0) {
        super(id, "speaki", scale);
        this.setAnimation("Speaki-Cherrful.png"); // Note: using typo from python code if file exists
        this.stateTimer = 100;

        this.walkSoundIndex = 1;
        this.walkSoundDelay = 0;
    }

    onDragStart() {
        this.setAnimation("Speaki-Cry.png");
        this.playSound("cry-drag.mp3");
    }

    onHitWall(side) {
        // Jump only at boundary
        if (this.onGround) {
            this.vy = -10;
            this.onGround = false;
            this.state = "JUMPING"; // Explicit state
            this.setAnimation("Speaki-Happu.png");
            this.playSound("jump.mp3");

            // Force turnaround velocity but keep Jumping state
            if (side === 'left') {
                this.vx = 2;
                this.facingRight = true;
            } else {
                this.vx = -2;
                this.facingRight = false;
            }
        }
    }

    behaviorTick() {
        if (this.isDragging) return;
        this.stateTimer--;

        if (this.onGround) {
            // Logic: Mostly walk, rarely idle
            if (this.stateTimer <= 0) {
                const action = Math.random();
                if (action < 0.02) { // 2% Idle (was 5%)
                    this.state = "IDLE";
                    this.stateTimer = 50 + Math.random() * 50; // Short idle
                    this.setAnimation("Speaki-Cherrful.png");
                } else if (action < 0.52) {
                    this.state = "WALK_LEFT";
                    this.stateTimer = 600 + Math.random() * 400; // Much longer walk (10-16s)
                    this.setAnimation("Speaki-Cherrful.png");

                    if (this.state !== "WALK_LEFT") this.walkSoundIndex = 1;
                } else {
                    this.state = "WALK_RIGHT";
                    this.stateTimer = 600 + Math.random() * 400; // Much longer walk
                    this.setAnimation("Speaki-Cherrful.png");
                    if (this.state !== "WALK_RIGHT") this.walkSoundIndex = 1;
                }
            }

            if (this.state === "WALK_LEFT") {
                this.vx -= 0.05; // Slower acceleration
                this.facingRight = false;
            } else if (this.state === "WALK_RIGHT") {
                this.vx += 0.05; // Slower acceleration
                this.facingRight = true;
            }

            // Speed cap (Slower max speed)
            if (this.vx > 1.5) this.vx = 1.5;
            if (this.vx < -1.5) this.vx = -1.5;

            // Walking Sounds (Natural Queue)
            if ((this.state === "WALK_LEFT" || this.state === "WALK_RIGHT") && !this.isPlaying) {
                this.playSound(`walk-${this.walkSoundIndex}.mp3`);
                this.walkSoundIndex++;
                if (this.walkSoundIndex > 3) this.walkSoundIndex = 1;
            }
        }
    }
}

class Erpin extends BasePet {
    constructor(id, scale = 1.0) {
        super(id, "erpin", scale);
        this.setAnimation("Erpin-Cherrful.png");
        this.stateTimer = 100;
    }

    onDragStart() {
        this.setAnimation("Erpin-Cry.png");
        const punchSounds = ["Erpin-Punch-1.mp3", "Erpin-Punch-2.mp3"];
        const randomSound = punchSounds[Math.floor(Math.random() * punchSounds.length)];
        this.playSound(randomSound);
    }

    onHitWall(side) {
        // Immediate turnaround
        if (side === 'left') {
            this.state = "WALK";
            this.facingRight = true;
            this.vx = 1.5;
        } else {
            this.state = "WALK";
            this.facingRight = false;
            this.vx = -1.5;
        }
    }

    behaviorTick() {
        if (this.isDragging) return;
        this.stateTimer--;

        if (this.state === "SLEEPING") {
            this.vx = 0;
            if (this.stateTimer <= 0) {
                // Wake up
                this.state = "IDLE";
                this.stateTimer = 100;
                this.setAnimation("Erpin-Cherrful.png");
            }
            return;
        }

        if (this.onGround) {
            // Interruption during walk to sleep
            if (this.state === "WALK" && Math.random() < 0.003) {
                this.state = "SLEEPING";
                this.stateTimer = 300 + Math.random() * 300; // 5-10 seconds
                this.setAnimation("Erpin-Sleeping.png");
                return;
            }

            if (this.stateTimer <= 0) {
                const action = Math.random();
                if (action < 0.02) {
                    // Sleep Chance (Less Frequent now, ~2%)
                    this.state = "SLEEPING";
                    this.stateTimer = 500 + Math.random() * 500;
                    this.setAnimation("Erpin-Sleeping.png");
                } else if (action < 0.12) {
                    this.state = "IDLE";
                    this.stateTimer = 100 + Math.random() * 100;
                    this.setAnimation("Erpin-Cherrful.png");
                } else if (action < 0.82) { // Mostly Walk
                    this.state = "WALK";
                    this.stateTimer = 200 + Math.random() * 200;
                    this.setAnimation("Erpin-Cherrful.png");
                    // Walk Sound Chance
                    if (Math.random() < 0.3 && !this.isPlaying) {
                        this.playSound("Erpin-humu.mp3");
                    }
                }
            }

            if (this.state === "WALK") {
                // Change direction less frequently
                if (Math.random() < 0.02) this.facingRight = !this.facingRight;

                this.vx += this.facingRight ? 1.5 : -1.5;
            }

            // Speed limit
            if (this.vx > 2.5) this.vx = 2.5;
            if (this.vx < -2.5) this.vx = -2.5;
        }
    }
}

class Gengar extends BasePet {
    constructor(id, scale = 1.0) {
        super(id, "gengar", scale);
        // Default animation (Eating Ramen)
        this.setAnimation("Gengar-Eat.png");
        this.stateTimer = 100;
    }

    onDragStart() {
        this.setAnimation("Gengar-Grab.png");
        this.playSound("gengar-grab.mp3");
    }

    onHitWall(side) {
        // Prevent infinite loop if already pouting at wall
        if (this.state === "POUT") return;

        // Pout near walls triggering "corner sulk"
        this.vx = 0;
        this.state = "POUT";
        this.stateTimer = 30; // Pout for 0.5s (was 2s)
        this.setAnimation("Gengar-pouty.png");
        this.playSound("gengar-laughing.mp3");

        // Prepare to walk away after pouting
        this.facingRight = (side === 'left');
    }

    behaviorTick() {
        if (this.isDragging) return;
        this.stateTimer--;

        if (this.state === "POUT") {
            if (this.stateTimer <= 0) {
                // Done pouting, walk away
                this.state = "WALK";
                this.stateTimer = 200;
                this.setAnimation("Gengar-Walk.png");
                // Walk away from wall
                this.vx = this.facingRight ? 1.5 : -1.5;
            }
            return;
        }

        if (this.onGround) {
            if (this.stateTimer <= 0) {
                const action = Math.random();
                if (action < 0.2) {
                    // Idle (Eating Ramen) - Reduced (20%)
                    this.state = "IDLE";
                    this.stateTimer = 30 + Math.random() * 20;
                    this.setAnimation("Gengar-Eat.png");
                    this.vx = 0;
                    if (Math.random() < 0.5) this.playSound("gengar-voice.mp3");
                } else if (action < 0.3) {
                    // Random Pout (10%)
                    this.state = "POUT";
                    this.stateTimer = 30 + Math.random() * 20;
                    this.setAnimation("Gengar-pouty.png");
                    this.vx = 0;
                    this.playSound("gengar-laughing.mp3");
                } else {
                    // Walk (70%)
                    this.state = "WALK";
                    this.stateTimer = 100 + Math.random() * 200;
                    this.setAnimation("Gengar-Walk.png");

                    if (this.vx === 0) {
                        this.facingRight = Math.random() > 0.5;
                    }
                    // Speak on start sometimes
                    if (Math.random() < 0.4) this.playSound("gengar-voice.mp3");
                }
            }

            if (this.state === "WALK") {
                // Slower Acceleration
                this.vx += this.facingRight ? 0.1 : -0.1;

                // Cap Speed (Reduced to 1.0)
                if (this.vx > 1.0) this.vx = 1.0;
                if (this.vx < -1.0) this.vx = -1.0;

                // Periodic Chatter during walk
                if (Math.random() < 0.002 && !this.isPlaying) { // ~Once every 8-10 seconds
                    this.playSound("gengar-voice.mp3");
                }
            } else {
                // Friction
                this.vx *= 0.8;
            }
        }
    }
}

let pets = [];
let soundEnabled = true;

const CLASS_MAP = {
    "speaki": Speaki,
    "erpin": Erpin,
    "gengar": Gengar
};

function syncPets(config) {
    soundEnabled = config.soundEnabled !== undefined ? config.soundEnabled : true;
    const targetScale = config.petScale !== undefined ? config.petScale : 0.5;

    // Update existing pets scale
    pets.forEach(p => {
        if (p.scale !== targetScale) {
            p.scale = targetScale;
            p.element.style.width = `${p.width * p.scale}px`;
            p.element.style.height = `${p.height * p.scale}px`;
        }
    });

    // Dynamic Sync based on Metadata
    PET_METADATA.forEach(meta => {
        const targetCount = config[meta.storageKey] !== undefined ? config[meta.storageKey] : (meta.id === 'speaki' || meta.id === 'erpin' ? 1 : 0);
        let currentCount = pets.filter(p => p.type === meta.id).length;

        // Add
        while (currentCount < targetCount) {
            // Instantiate specific class if exists, else could fallback (feature for later)
            const PetClass = CLASS_MAP[meta.id];
            if (PetClass) {
                pets.push(new PetClass(Date.now() + Math.random(), targetScale));
            }
            currentCount++;
        }

        // Remove
        while (currentCount > targetCount) {
            const idx = pets.findIndex(p => p.type === meta.id);
            if (idx !== -1) {
                pets[idx].element.remove();
                pets.splice(idx, 1);
            }
            currentCount--;
        }
    });
}

function init() {
    console.log("Trickcal Chibi Go Pet Extensions Started!");

    const keys = PET_METADATA.map(p => p.storageKey).concat(['petScale', 'soundEnabled']);

    chrome.storage.local.get(keys, (result) => {
        syncPets(result);
        gameLoop();
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        chrome.storage.local.get(keys, (result) => {
            syncPets(result);
        });
    });
}

function gameLoop() {
    if (!isContextValid) return; // Stop loop if extension updated/reloaded

    // Check if we are on a valid page (simple check: if specific site rules return null, we might want to hide)
    // For now, we rely on the pets existing. If we want to hide them on non-chat pages:
    const host = window.location.hostname;
    if (host.includes("replit.com") && !window.location.pathname.includes('/@') && !window.location.pathname.includes('/~')) {
        // Hide all pets on Replit dashboard (if neither /@ nor /~)
        pets.forEach(p => p.element.style.display = 'none');
        requestAnimationFrame(gameLoop);
        return;
    } else if (host.includes("blackbox.ai") && !document.querySelector('#chat-input-box')) {
        // Hide on Blackbox non-chat pages (landing page etc)
        pets.forEach(p => p.element.style.display = 'none');
        requestAnimationFrame(gameLoop);
        return;
    } else {
        pets.forEach(p => p.element.style.display = 'block');
    }

    for (const pet of pets) {
        pet.physicsTick();
        pet.behaviorTick();
    }
    requestAnimationFrame(gameLoop);
}

// Check if sound should play global override
const originalPlaySound = BasePet.prototype.playSound;
BasePet.prototype.playSound = function (filename) {
    if (!soundEnabled) return;
    originalPlaySound.call(this, filename);
};

// Start after a short delay
setTimeout(init, 1000);
