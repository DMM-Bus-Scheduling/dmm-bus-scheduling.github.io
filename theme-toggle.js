export function getCurrentTheme() {
    return (
        document.documentElement.getAttribute('data-theme')
        || 'light'
    );
}

export function setTheme(theme) {
    document.documentElement.setAttribute(
        'data-theme',
        theme
    );

    localStorage.setItem(
        'theme',
        theme
    );
}

export function toggleTheme() {
    const currentTheme = getCurrentTheme();

    const newTheme =
        currentTheme === 'dark'
            ? 'light'
            : 'dark';

    setTheme(newTheme);

    return newTheme;
}

export function loadSavedTheme() {
    const savedTheme =
        localStorage.getItem('theme');

    if (savedTheme) {
        setTheme(savedTheme);
    }

    return getCurrentTheme();
}

const themeChangeListeners = new Set();

export function onThemeChange(fn) {
    themeChangeListeners.add(fn);
    return () => themeChangeListeners.delete(fn); // unsubscribe
}

async function notifyThemeChange(theme) {
    for (const fn of themeChangeListeners) {
        await fn(theme);
    }
}

export function initThemeToggle({ buttonId }) {
    const button = document.getElementById(buttonId);

    if (!button) {
        console.warn(`Theme toggle button '${buttonId}' not found`);
        return;
    }

    button.addEventListener('click', async () => {
        const theme = toggleTheme();
        await notifyThemeChange(theme);
    });
}