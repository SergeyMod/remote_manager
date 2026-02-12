function showToast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(`${type}: ${message}`);
    }
}

// Глобальная переменная для сохранённых параметров
let savedParameters = [];

// Загрузка сохранённых параметров
async function loadSavedParameters() {
    try {
        const res = await fetch('/api/parameters');
        savedParameters = await res.json();
        const select = document.getElementById('saved-parameters-select');
        select.innerHTML = '<option value="">Выбрать сохранённый параметр...</option>';
        savedParameters.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} - ${p.value}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Ошибка загрузки параметров:', e);
    }
}

function addScriptParameter(name = '', defaultValue = '', description = '') {
    const container = document.getElementById('script-parameters');
    const div = document.createElement('div');
    div.className = 'param-row';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.marginBottom = '0.5rem';
    div.innerHTML = `
        <input type="text" placeholder="Имя" value="${name}" style="flex:1;" data-field="name">
        <input type="text" placeholder="Значение по умолчанию" value="${defaultValue}" style="flex:1;" data-field="default_value">
        <input type="text" placeholder="Описание" value="${description}" style="flex:2;" data-field="description">
        <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
}

function loadSavedParameter() {
    const select = document.getElementById('saved-parameters-select');
    const selectedId = select.value;
    if (!selectedId) return;

    const param = savedParameters.find(p => p.id == selectedId);
    if (param) {
        addScriptParameter(param.name, param.value, param.description);
    }
}

document.getElementById('script-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('script-name').value.trim();
    const content = document.getElementById('script-content').value.trim();
    if (!name || !content) {
        alert('Заполните все обязательные поля');
        return;
    }

    const params = [];
    document.querySelectorAll('#script-parameters > .param-row').forEach(row => {
        const name = row.querySelector('[data-field="name"]')?.value.trim();
        if (name) {
            params.push({
                name,
                default_value: row.querySelector('[data-field="default_value"]')?.value || '',
                description: row.querySelector('[data-field="description"]')?.value || ''
            });
        }
    });

    const scriptData = { name, content, params };
    const scriptId = document.getElementById('script-id')?.value || '';

    try {
        let url = '/api/scripts';
        let method = 'POST';
        if (scriptId) {
            url = `/api/scripts/${scriptId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scriptData)
        });

        if (res.ok) {
            window.location.href = '/scripts';
        } else {
            const err = await res.json();
            alert(`Ошибка: ${err.detail}`);
        }
    } catch (e) {
        console.error(e);
        alert('Ошибка сохранения');
    }
});

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    loadSavedParameters();
});