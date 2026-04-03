// This script will be executed in the browser console to clear all accounts
localStorage.removeItem('user');
localStorage.removeItem('accessToken');
console.log('All accounts cleared! You can now create a new account.');
