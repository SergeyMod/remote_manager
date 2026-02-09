// Вспомогательные функции
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Управление машинами
async function loadMachines() {
    const container = document.getElementById('machines-container');

    try {
        const response = await fetch('/api/machines');
        const machines = await response.json();

        container.innerHTML = '';

        if (machines.length === 0) {
            container.innerHTML = '<div class="loading">Нет машин. Добавьте первую машину.</div>';
            return;
        }

        machines.forEach(machine => {
            const card = document.createElement('div');
            card.className = 'machine-card';

            const statusClass = machine.is_active ? 'status-online' : 'status-offline';
            const statusText = machine.is_active ? 'Онлайн' : 'Оффлайн';
            const currentBadge = machine.is_current ? '<span class="status-current">Текущая</span>' : '';

            card.innerHTML = `
                <div class="machine-header">
                    <div class="machine-title">
                        <i class="fas fa-desktop"></i> ${machine.name}
                    </div>
                    <div>
                        ${currentBadge}
                        <span class="machine-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="machine-info">
                    <div><i class="fas fa-network-wired"></i> ${machine.address}:${machine.ssh_port}</div>
                    <div><i class="fas fa-user"></i> ${machine.username}</div>
                    <div><i class="fas fa-clock"></i> Последняя проверка: ${new Date(machine.last_checked).toLocaleString()}</div>
                </div>
                <div class="machine-actions">
                    <button class="btn btn-sm" onclick="viewMachineProcesses(${machine.id})">
                        <i class="fas fa-tasks"></i> Процессы
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="editMachine(${machine.id})">
                        <i class="fas fa-edit"></i> Редактировать
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="testMachine(${machine.id})">
                        <i class="fas fa-plug"></i> Проверить
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteMachine(${machine.id})">
                        <i class="fas fa-trash"></i> Удалить
                    </button>
                </div>
            `;

            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading machines:', error);
        showToast('Ошибка загрузки машин', 'error');
    }
}

async function testAllMachines() {
    try {
        showToast('Проверка всех машин...', 'info');
        const response = await fetch('/api/machines/batch-test', { method: 'POST' });
        const results = await response.json();

        let successCount = 0;
        let deactivatedCount = 0;
        results.forEach(result => {
            if (result.success) successCount++;
            if (result.deactivated) deactivatedCount++;
        });

        showToast(`Проверено: ${successCount}/${results.length} успешно${deactivatedCount ? ', помечено неактивными: ' + deactivatedCount : ''}`, 'success');
        loadMachines();
    } catch (error) {
        console.error('Error testing machines:', error);
        showToast('Ошибка проверки машин', 'error');
    }
}

function showAddMachineModal() {
    document.getElementById('machine-id').value = '';
    document.getElementById('machine-name').value = '';
    document.getElementById('machine-address').value = '';
    document.getElementById('ssh-port').value = '22';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('modal-title').textContent = 'Добавить машину';
    document.getElementById('save-machine-btn').disabled = true;
    document.getElementById('machine-modal').style.display = 'flex';
}

function closeMachineModal() {
    document.getElementById('machine-modal').style.display = 'none';
}

async function testMachineConnection() {
    const address = document.getElementById('machine-address').value;
    const port = document.getElementById('ssh-port').value || 22;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!address || !username || !password) {
        showToast('Заполните все поля для тестирования', 'error');
        return;
    }

    try {
        const response = await fetch('/api/machines/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address,
                ssh_port: parseInt(port),
                username,
                password
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast('Подключение успешно', 'success');
            document.getElementById('save-machine-btn').disabled = false;
        } else {
            showToast(`Ошибка: ${result.message}`, 'error');
            document.getElementById('save-machine-btn').disabled = true;
        }
    } catch (error) {
        console.error('Error testing connection:', error);
        showToast('Ошибка тестирования подключения', 'error');
        document.getElementById('save-machine-btn').disabled = true;
    }
}

async function saveMachine() {
    const machineId = document.getElementById('machine-id').value;
    const machineData = {
        name: document.getElementById('machine-name').value,
        address: document.getElementById('machine-address').value,
        ssh_port: parseInt(document.getElementById('ssh-port').value) || 22,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
    };

    try {
        let response;
        if (machineId) {
            response = await fetch(`/api/machines/${machineId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(machineData)
            });
        } else {
            response = await fetch('/api/machines', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(machineData)
            });
        }

        if (response.ok) {
            showToast(`Машина ${machineId ? 'обновлена' : 'добавлена'}`, 'success');
            closeMachineModal();
            loadMachines();
            checkCurrentMachine();
        } else {
            const error = await response.json();
            showToast(`Ошибка: ${error.detail}`, 'error');
        }
    } catch (error) {
        console.error('Error saving machine:', error);
        showToast('Ошибка сохранения машины', 'error');
    }
}

async function editMachine(machineId) {
    try {
        const response = await fetch(`/api/machines/${machineId}`);
        const machine = await response.json();

        document.getElementById('machine-id').value = machine.id;
        document.getElementById('machine-name').value = machine.name;
        document.getElementById('machine-address').value = machine.address;
        document.getElementById('ssh-port').value = machine.ssh_port;
        document.getElementById('username').value = machine.username;
        document.getElementById('password').value = machine.password;
        document.getElementById('modal-title').textContent = 'Редактировать машину';
        document.getElementById('save-machine-btn').disabled = false;
        document.getElementById('machine-modal').style.display = 'flex';
    } catch (error) {
        console.error('Error loading machine:', error);
        showToast('Ошибка загрузки машины', 'error');
    }
}

async function testMachine(machineId) {
    try {
        showToast('Проверка подключения...', 'info');
        const response = await fetch(`/api/machines/${machineId}/test`, { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            showToast('Подключение успешно', 'success');
        } else {
            if (result.deactivated) {
                showToast(`Машина помечена как неактивная: ${result.message}`, 'error');
            } else {
                showToast(`Ошибка: ${result.message}`, 'error');
            }
        }
        loadMachines();
    } catch (error) {
        console.error('Error testing machine:', error);
        showToast('Ошибка проверки подключения', 'error');
    }
}

async function deleteMachine(machineId) {
    if (!confirm('Вы уверены, что хотите удалить эту машину?')) return;

    try {
        const response = await fetch(`/api/machines/${machineId}`, { method: 'DELETE' });

        if (response.ok) {
            showToast('Машина удалена', 'success');
            loadMachines();
            checkCurrentMachine();
        } else {
            const error = await response.json();
            showToast(`Ошибка: ${error.detail}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting machine:', error);
        showToast('Ошибка удаления машины', 'error');
    }
}

function viewMachineProcesses(machineId) {
    window.location.href = `/processes?machine=${machineId}`;
}

//// Управление пользователями
//async function loadUsers() {
//    try {
//        const response = await fetch('/api/users');
//        const users = await response.json();
//
//        const select = document.getElementById('username');
//        // Сохраняем текущее значение
//        const currentValue = select.value;
//
//        // Очищаем и добавляем опции
//        select.innerHTML = '<option value="">Выберите пользователя</option>';
//        users.forEach(user => {
//            const option = document.createElement('option');
//            option.value = user.username;
//            option.textContent = user.username;
//            select.appendChild(option);
//        });
//
//        // Восстанавливаем значение
//        select.value = currentValue;
//    } catch (error) {
//        console.error('Error loading users:', error);
//    }
//}

function showAddUserModal() {
    document.getElementById('user-username').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-modal').style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('user-modal').style.display = 'none';
}

async function saveUser() {
    const userData = {
        username: document.getElementById('user-username').value,
        password: document.getElementById('user-password').value
    };

    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });

        if (response.ok) {
            showToast('Пользователь добавлен', 'success');
            closeUserModal();
            loadUsers();
        } else {
            const error = await response.json();
            showToast(`Ошибка: ${error.detail}`, 'error');
        }
    } catch (error) {
        console.error('Error saving user:', error);
        showToast('Ошибка сохранения пользователя', 'error');
    }
}

// Проверка текущей машины
async function checkCurrentMachine() {
    try {
        const response = await fetch('/api/current-machine');
        const result = await response.json();

        const alert = document.getElementById('current-machine-alert');
        const text = document.getElementById('current-machine-text');
        const btn = document.getElementById('add-current-machine-btn');

        if (result.exists) {
            text.textContent = `Текущая машина: ${result.machine.name} (${result.machine.address})`;
            btn.style.display = 'none';
            alert.style.display = 'flex';
        } else {
            text.textContent = `Текущая машина не добавлена: ${result.address}`;
            btn.style.display = 'inline-block';
            alert.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error checking current machine:', error);
    }
}

async function addCurrentMachine() {
    const name = prompt('Введите название для текущей машины:', 'Локальная машина');
    if (!name) return;

    const username = prompt('Введите имя пользователя SSH:');
    if (!username) return;

    const password = prompt('Введите пароль SSH:');
    if (!password) return;

    try {
        const response = await fetch('/api/add-current-machine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                ssh_port: 22,
                username: username,
                password: password
            })
        });

        if (response.ok) {
            showToast('Текущая машина добавлена', 'success');
            loadMachines();
            checkCurrentMachine();
        } else {
            const error = await response.json();
            showToast(`Ошибка: ${error.detail}`, 'error');
        }
    } catch (error) {
        console.error('Error adding current machine:', error);
        showToast('Ошибка добавления текущей машины', 'error');
    }
}

// WebSocket соединение для обновлений
let ws = null;

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(`ws://${window.location.host}/ws/updates`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
            showToast('Данные обновлены', 'info');
            // Обновляем данные на странице
            if (window.location.pathname.includes('/machines')) {
                loadMachines();
            }
            // Если обновились параметры, перезагрузим их (если функция доступна)
            if (data.entity && data.entity === 'parameters') {
                if (typeof loadParameters === 'function') {
                    try { loadParameters(); } catch (e) { console.warn(e); }
                }
                if (typeof renderParameterSection === 'function') {
                    try { renderParameterSection(); } catch (e) { console.warn(e); }
                }
            }
        }
    };
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    connectWebSocket();

    // Автообновление каждые 30 секунд
    setInterval(() => {
        if (window.location.pathname.includes('/machines')) {
            loadMachines();
        }
    }, 30000);
});

// Экспорт функций для использования в других файлах
window.showToast = showToast;
window.loadMachines = loadMachines;
window.testAllMachines = testAllMachines;
window.showAddMachineModal = showAddMachineModal;
window.closeMachineModal = closeMachineModal;
window.testMachineConnection = testMachineConnection;
window.saveMachine = saveMachine;
window.editMachine = editMachine;
window.testMachine = testMachine;
window.deleteMachine = deleteMachine;
window.viewMachineProcesses = viewMachineProcesses;
window.showAddUserModal = showAddUserModal;
window.closeUserModal = closeUserModal;
window.saveUser = saveUser;
window.checkCurrentMachine = checkCurrentMachine;
window.addCurrentMachine = addCurrentMachine;