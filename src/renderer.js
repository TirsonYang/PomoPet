/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 */

import './style.css';

console.log('👋 This message is being logged by "renderer.js", included via Vite');

// Todo Logic
const todoInput = document.getElementById('todo-input');
const addTodoBtn = document.getElementById('add-todo-btn');
const todoList = document.getElementById('todo-list');
const clearCompletedBtn = document.getElementById('clear-completed-btn');

// Load Todos
async function loadTodos() {
  const todos = await window.api.invoke('todos:load');
  renderTodos(todos);
}

// Render Todos
function renderTodos(todos) {
  todoList.innerHTML = '';
  todos.forEach(todo => {
    const li = document.createElement('li');
    li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
    
    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!todo.completed;
    checkbox.onclick = () => toggleTodo(todo.id, !todo.completed);
    
    // Text
    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = todo.text;
    
    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.innerHTML = '✖'; // Or use an icon
    deleteBtn.onclick = () => deleteTodo(todo.id);
    
    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(deleteBtn);
    todoList.appendChild(li);
  });
}

// Add Todo
async function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  
  await window.api.invoke('todos:add', { text });
  todoInput.value = '';
  loadTodos();
}

// Toggle Todo
async function toggleTodo(id, completed) {
  await window.api.invoke('todos:toggle', { id, completed });
  loadTodos();
}

// Delete Todo
async function deleteTodo(id) {
  // Removed confirmation as requested by user to fix input focus issue
  await window.api.invoke('todos:delete', { id });
  loadTodos();
}

// Clear Completed
async function clearCompleted() {
  await window.api.invoke('todos:clear-completed');
  loadTodos();
}

// Event Listeners
addTodoBtn.addEventListener('click', addTodo);
todoInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTodo();
});
clearCompletedBtn.addEventListener('click', clearCompleted);

// Initial Load
loadTodos();

// --- Pomodoro Logic ---
const DEFAULT_TIME = 25 * 60; // 25 minutes in seconds
let timeLeft = DEFAULT_TIME;

const timeDisplay = document.getElementById('time-display');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const timerCanvas = document.getElementById('timer-canvas');
const ctx = timerCanvas.getContext('2d');
const todayStatsEl = document.getElementById('today-stats');

// Canvas Config
const centerX = timerCanvas.width / 2;
const centerY = timerCanvas.height / 2;
const radius = 80;
const lineWidth = 10;

function drawTimer() {
  ctx.clearRect(0, 0, timerCanvas.width, timerCanvas.height);

  // Background Circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Progress Arc
  const progress = timeLeft / DEFAULT_TIME;
  const endAngle = (2 * Math.PI * progress);

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, endAngle, false); 
  
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function updateDisplay() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  drawTimer();
}

async function startTimer() {
  await window.api.invoke('pomodoro:start');
  updateButtons(true);
}

async function pauseTimer() {
  await window.api.invoke('pomodoro:pause');
  updateButtons(false);
}

async function resetTimer() {
  await window.api.invoke('pomodoro:reset');
  // UI update will happen via 'pomodoro:tick' event immediately or we can fetch state
  // But usually main process sends a tick on reset or we wait for next update.
  // Actually main process implementation of reset sends broadcastTick()
  updateButtons(false);
}

function updateButtons(running) {
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
}

// IPC Listeners
window.api.on('pomodoro:tick', (secondsLeft) => {
  timeLeft = secondsLeft;
  updateDisplay();
});

window.api.on('pomodoro:completed', () => {
  updateButtons(false);
  
  // Notification
  new Notification('番茄钟结束', {
    body: '该休息一下啦！',
    icon: '/path/to/icon.png' // Optional
  });
  
  loadStats();
});

async function initPomodoro() {
  const state = await window.api.invoke('pomodoro:get-state');
  timeLeft = state.secondsLeft;
  updateDisplay();
  updateButtons(state.active);
  loadStats();
}

async function loadStats() {
  const stats = await window.api.invoke('pomodoro:stats');
  todayStatsEl.textContent = `今日专注：${stats.count}次，共${stats.total_minutes}分钟`;
}

// Listeners
startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

// --- Pet Logic ---
const petContainer = document.getElementById('pet-container');
const cat = document.getElementById('cat');
const speechBubble = document.getElementById('pet-speech-bubble');
const speechText = document.getElementById('speech-text');
const petMoodText = document.getElementById('pet-mood-text');
const petCoinsText = document.getElementById('pet-coins');

let petState = {
  current_mood: 'default',
  hunger_level: 0,
  last_fed_time: null,
  total_coins: 0
};

const TIPS = [
  "专注模式已开启，放下杂念，开始行动！",
  "番茄钟启动，此刻只做一件事！",
  "专注时间到，屏蔽干扰，聚焦目标！",
  "慢慢来，把注意力交给当下的任务吧 ✨",
  "今天的专注，是未来的铺垫～",
  "别着急，专注每一分钟就好～",
  "叮！你的「专注 buff」已生效，拒绝摸鱼！",
  "番茄钟已发车，目的地：高效完成任务 🚀",
  "注意力充值成功，开始打怪升级！"
];

// Helper: Save Pet State
async function savePetState() {
  await window.api.invoke('pet:save', petState);
  updatePetUI();
}

// Helper: Set Mood
function setMood(mood, save = true) {
  // Clear previous moods
  cat.classList.remove('mood-default', 'mood-focused', 'mood-happy', 'mood-tips');
  cat.classList.add(`mood-${mood}`);
  
  petState.current_mood = mood;
  if (save) savePetState();
  
  // Update UI text mapping
  const moodMap = {
    'default': '开心',
    'focused': '专注',
    'happy': '超开心',
    'tips': '想说话'
  };
  petMoodText.textContent = `当前心情：${moodMap[mood] || '平静'}`;
}

// Helper: Update UI
function updatePetUI() {
  // Mood text is updated in setMood mostly, but coins need update
  petCoinsText.textContent = `💰 ${petState.total_coins}`;
}

// Initial Load
async function loadPet() {
  petState = await window.api.invoke('pet:load');
  // Reset visual mood to saved mood
  setMood(petState.current_mood, false);
  updatePetUI();
}

// Events
petContainer.addEventListener('mouseenter', async () => {
  // Check if pomodoro is active
  const { active } = await window.api.invoke('pomodoro:get-state');
  
  if (!active) return; // If not active, do nothing (keep default mood)
  
  // Even if active, if mood is focused, usually we might not want to disturb,
  // BUT the user request says: "if active, change to tips".
  // Originally we had: if (petState.current_mood === 'focused') return;
  // This would prevent tips during focus. 
  // Let's assume user WANTS to see tips when hovering DURING focus.
  // So we proceed.
  
  // Show random tip
  const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)];
  speechText.textContent = randomTip;
  speechBubble.classList.remove('hidden');
  
  // Temp mood
  cat.classList.remove('mood-default', 'mood-focused', 'mood-happy');
  cat.classList.add('mood-tips');
});

petContainer.addEventListener('mouseleave', async () => {
  const { active } = await window.api.invoke('pomodoro:get-state');
  if (!active) return; // If not active, we didn't change anything, so nothing to restore
  
  speechBubble.classList.add('hidden');
  // Restore mood to what it should be (likely focused if active)
  setMood(petState.current_mood, false); 
});

// Integration Hooks

// 1. Pomodoro Start -> Focused
const originalStartTimer = startTimer; // Hook into existing function
startTimer = async function() {
  await originalStartTimer();
  setMood('focused');
};

// 2. Pomodoro End -> Happy (3s) -> Default
window.api.on('pomodoro:completed', async () => {
  // ... existing logic runs first ...
  
  setMood('happy');
  petState.total_coins += 10; // Reward
  savePetState();
  
  setTimeout(() => {
    setMood('default');
  }, 3000);
});

// 3. Todo Completed -> Happy (2s) -> Default
// Modify toggleTodo to return result or check state
const originalToggleTodo = toggleTodo;
toggleTodo = async function(id, completed) {
  await originalToggleTodo(id, completed);
  
  if (completed) {
    const prevMood = petState.current_mood;
    if (prevMood !== 'focused') {
      setMood('happy');
      petState.total_coins += 1; // Small reward
      savePetState();
      
      setTimeout(() => {
        setMood(prevMood); // Restore previous mood
      }, 2000);
    }
  }
};

// Init
initPomodoro();
loadPet();

