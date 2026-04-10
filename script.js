// Configuration
const GOOGLE_APPS_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';

// State management
let currentUser = null;
let selectedRating = 0;
let todaySubmission = null;
let userHistory = [];

// Rating labels
const RATING_LABELS = {
    1: "Unavailable - Little to no meaningful interaction",
    2: "Distant - Minimal engagement, felt disconnected",
    3: "Good - Solid connection, normal day",
    4: "Great - Strong engagement, felt very connected",
    5: "Perfect - Exceptional attention and connection"
};

// DOM elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');
const ratingFeedback = document.getElementById('rating-feedback');
const commentInput = document.getElementById('comment');
const submitBtn = document.getElementById('submit-btn');
const submissionStatus = document.getElementById('submission-status');
const historyList = document.getElementById('history-list');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeGoogleAuth();
    checkExistingSession();
    setupEventListeners();
    
    // Update Google Client ID in DOM
    const gidOnload = document.getElementById('g_id_onload');
    if (gidOnload) {
        gidOnload.setAttribute('data-client_id', GOOGLE_CLIENT_ID);
    }
});

function initializeGoogleAuth() {
    // Google Sign-In configuration is handled via HTML data attributes
    console.log('Google Auth initialized');
}

function checkExistingSession() {
    const savedUser = localStorage.getItem('attentionTracker_user');
    const savedHistory = localStorage.getItem('attentionTracker_history');
    
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showDashboard();
        loadUserData();
    }
    
    if (savedHistory) {
        userHistory = JSON.parse(savedHistory);
        updateHistoryDisplay();
    }
}

function setupEventListeners() {
    logoutBtn.addEventListener('click', handleLogout);
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Number keys 1-5 for rating selection
        if (e.key >= '1' && e.key <= '5' && dashboardScreen.classList.contains('active')) {
            setRating(parseInt(e.key));
        }
        
        // Ctrl+Enter to submit
        if (e.ctrlKey && e.key === 'Enter' && dashboardScreen.classList.contains('active')) {
            submitEntry();
        }
    });
}

// Google Sign-In handler
function handleGoogleSignIn(response) {
    const userData = decodeJWT(response.credential);
    
    // Verify it's a Gmail account
    if (userData.email && userData.email.endsWith('@gmail.com')) {
        currentUser = {
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            id: userData.sub
        };
        
        localStorage.setItem('attentionTracker_user', JSON.stringify(currentUser));
        showDashboard();
        loadUserData();
    } else {
        showError("Please sign in with a Gmail account");
    }
}

function decodeJWT(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('Error decoding JWT:', error);
        return {};
    }
}

function showDashboard() {
    loginScreen.classList.remove('active');
    dashboardScreen.classList.add('active');
    
    // Update user info
    if (currentUser) {
        userAvatar.src = currentUser.picture;
        userName.textContent = currentUser.name;
    }
    
    // Check if already submitted today
    checkTodaysSubmission();
}

function handleLogout() {
    currentUser = null;
    selectedRating = 0;
    todaySubmission = null;
    
    localStorage.removeItem('attentionTracker_user');
    localStorage.removeItem('attentionTracker_history');
    
    loginScreen.classList.add('active');
    dashboardScreen.classList.remove('active');
    
    // Reset Google Sign-In
    google.accounts.id.disableAutoSelect();
}

// Rating functionality
function setRating(rating) {
    selectedRating = rating;
    
    // Update star visuals
    document.querySelectorAll('.star').forEach(star => {
        star.classList.remove('selected');
        if (parseInt(star.dataset.value) <= rating) {
            star.classList.add('selected');
        }
    });
    
    // Update feedback text
    ratingFeedback.textContent = RATING_LABELS[rating];
    ratingFeedback.style.opacity = '1';
}

// Submission logic
async function submitEntry() {
    if (!currentUser) {
        showError("Please sign in first");
        return;
    }
    
    if (selectedRating === 0) {
        showError("Please select a rating first");
        return;
    }
    
    if (todaySubmission) {
        showInfo("You've already submitted an entry for today");
        return;
    }
    
    const comment = commentInput.value.trim();
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    
    // Prepare submission data
    const submissionData = {
        date: today,
        userEmail: currentUser.email,
        ratingValue: selectedRating,
        comment: comment,
        dayOfWeek: dayOfWeek
    };
    
    // Disable submit button during submission
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    
    try {
        // Send to Google Apps Script
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(submissionData)
        });
        
        if (response.ok) {
            // Store locally
            todaySubmission = submissionData;
            userHistory.unshift(submissionData);
            
            // Keep only last 7 days
            if (userHistory.length > 7) {
                userHistory = userHistory.slice(0, 7);
            }
            
            localStorage.setItem('attentionTracker_history', JSON.stringify(userHistory));
            
            showSuccess("Daily entry submitted successfully!");
            updateHistoryDisplay();
            resetForm();
        } else {
            throw new Error('Server error: ' + response.status);
        }
    } catch (error) {
        console.error('Submission error:', error);
        showError("Failed to submit entry. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Today's Entry";
    }
}

function checkTodaysSubmission() {
    const today = new Date().toISOString().split('T')[0];
    
    // Check local history first
    const todaysEntry = userHistory.find(entry => entry.date === today);
    
    if (todaysEntry) {
        todaySubmission = todaysEntry;
        showInfo("You've already submitted an entry for today");
        submitBtn.disabled = true;
        submitBtn.textContent = "Daily Entry Complete";
    } else {
        todaySubmission = null;
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Today's Entry";
        submissionStatus.textContent = '';
        submissionStatus.className = 'submission-status';
    }
}

function resetForm() {
    selectedRating = 0;
    commentInput.value = '';
    
    document.querySelectorAll('.star').forEach(star => {
        star.classList.remove('selected');
    });
    
    ratingFeedback.textContent = '';
    ratingFeedback.style.opacity = '0';
}

// Status messages
function showSuccess(message) {
    submissionStatus.textContent = message;
    submissionStatus.className = 'submission-status success';
    
    setTimeout(() => {
        submissionStatus.textContent = '';
        submissionStatus.className = 'submission-status';
    }, 3000);
}

function showError(message) {
    submissionStatus.textContent = message;
    submissionStatus.className = 'submission-status error';
    
    setTimeout(() => {
        submissionStatus.textContent = '';
        submissionStatus.className = 'submission-status';
    }, 3000);
}

function showInfo(message) {
    submissionStatus.textContent = message;
    submissionStatus.className = 'submission-status info';
}

// History display
function updateHistoryDisplay() {
    if (userHistory.length === 0) {
        historyList.innerHTML = '<div class="empty-history">No entries yet. Submit your first rating!</div>';
        return;
    }
    
    historyList.innerHTML = userHistory.map(entry => `
        <div class="history-item">
            <div class="history-date">
                ${formatDate(entry.date)} • ${entry.dayOfWeek}
            </div>
            <div class="history-rating">
                <span>${'⭐'.repeat(entry.ratingValue)}</span>
                <span>${entry.ratingValue}/5 - ${getRatingLabel(entry.ratingValue)}</span>
            </div>
            ${entry.comment ? `<div class="history-comment">"${entry.comment}"</div>` : ''}
        </div>
    `).join('');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getRatingLabel(rating) {
    const labels = {
        1: 'Unavailable',
        2: 'Distant',
        3: 'Good',
        4: 'Great',
        5: 'Perfect'
    };
    return labels[rating] || 'Unknown';
}

// Load user data (simulated - would normally come from Google Sheets)
function loadUserData() {
    // This would typically fetch from Google Sheets via Apps Script
    // For now, we'll use localStorage data
    console.log('Loading user data for:', currentUser.email);
    
    // Simulate loading delay
    setTimeout(() => {
        updateHistoryDisplay();
        checkTodaysSubmission();
    }, 500);
}

// Utility function to get star emojis
function getStars(rating) {
    return '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
}