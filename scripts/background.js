//Constants
const LEETCODE_URL = 'https://leetcode.com';
const RULE_ID = 1;
// Helper functions
const isLeetCodeUrl = (url) => url.includes(LEETCODE_URL);

const isSubmissionSuccessURL = (url) =>
  url.includes('/submissions/detail/') && url.includes('/check/');

const sendUserSolvedMessage = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'userSolvedProblem' });
  });
};

//Global modifiable variables (I know, I know, but it's the easiest way to do it fix it yourself)

let leetcodeProblemSolved = false;
let leetCodeProblem = {
  url: '',
  name: '',
};
let userJustSubmitted = false;

// TODO: Need to find a way to filter out premium problems
const generateRandomLeetCodeProblem = async () => {
  try {
    const res = await fetch(
      chrome.runtime.getURL('leetCode-problems/blind75Problems.json')
    );
    const leetCodeProblems = await res.json();
    const randomIndex = Math.floor(Math.random() * leetCodeProblems.length);
    const randomProblem = leetCodeProblems[randomIndex];
    const randomProblemURL = randomProblem.href;
    const randomProblemName = randomProblem.text;
    return { randomProblemURL, randomProblemName };
  } catch (error) {
    console.error('Error generating random problem', error);
  }
};

// Communication functions between background.js, popup.js, and content.js
const onMessageReceived = (message, sender, sendResponse) => {
  switch (message.action) {
    case 'getProblemStatus':
      sendResponse({
        problemSolved: leetcodeProblemSolved,
        problem: leetCodeProblem,
      });
      break;
    case 'userClickedSubmit':
      userJustSubmitted = true;
      setTimeout(() => {
        userJustSubmitted = false;
      }, 30000); // Reset after 30 seconds
      break;
    default:
      console.warn('Unknown message action:', message.action);
  }
};

async function setRedirectRule(newRedirectUrl) {
  let newRedirectRule = {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { url: newRedirectUrl },
    },
    condition: {
      urlFilter: '*://*/*',
      excludedDomains: [
        'leetcode.com',
        'www.leetcode.com',
        'developer.chrome.com',
      ],
      resourceTypes: ['main_frame'],
    },
  };

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [newRedirectRule],
    });
    console.log('Redirect rule updated');
  } catch (error) {
    console.error('Error updating redirect rule:', error);
  }
}
const updateStorage = async () => {
  try {
    let { randomProblemURL, randomProblemName } =
      await generateRandomLeetCodeProblem();
    leetcodeProblemSolved = false;
    leetCodeProblem = { url: randomProblemURL, name: randomProblemName };
    await chrome.storage.local.set({
      problemURL: randomProblemURL,
      problemName: randomProblemName,
      problemDate: new Date().toDateString(),
      leetCodeProblemSolved: false,
    });
    await setRedirectRule(randomProblemURL);
  } catch (error) {
    console.error('Error updating storage:', error);
  }
};

const sendMessageToContentScript = (tabId, message, callback) => {
  chrome.tabs.sendMessage(tabId, { action: 'ping' }, {}, (response) => {
    if (response && response.action === 'pong') {
      chrome.tabs.sendMessage(tabId, message, callback);
    } else {
      console.warn('Content script not ready yet');
    }
  });
};
const checkIfUserSolvedProblem = async (details) => {
  if (userJustSubmitted && isSubmissionSuccessURL(details.url)) {
    try {
      const response = await fetch(details.url);
      const data = await response.json();

      if (data.status_msg === 'Accepted' && data.state === 'SUCCESS') {
        console.log('User solved the problem');
        console.log(
          "Congratulations! You've solved the problem!, I'll see you tomorrow"
        );
        updateStreak();
        userJustSubmitted = false;
        leetcodeProblemSolved = true;
        // They solved the problem, so no need to redirect anymore they're free, for now
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [RULE_ID], // use RULE_ID constant
        });
        chrome.storage.local.set({ leetCodeProblemSolved: true });
        sendUserSolvedMessage();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
};

function updateStreak() {
  chrome.storage.local.get(['lastCompleted', 'currentStreak', 'bestStreak'], (data) => {
    const lastCompleted = new Date(data.lastCompleted ?? 0); // Returns Unix Epoch if item is null
    const now = new Date();

    if (lastCompleted.toDateString() === now.toDateString()) return;

    // This is the first problem that was solved today
    const currentStreak = parseInt(data.currentStreak ?? '0');
    const bestStreak = parseInt(data.bestStreak ?? '0');

    const newStreak = currentStreak + 1;

    chrome.storage.local.set({
      currentStreak: newStreak,
      lastCompleted: now.toDateString()
    });

    if (newStreak > bestStreak) {
      chrome.storage.local.set({bestStreak: newStreak});
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "testUpdateStreak") {
    updateStreak();
    console.log("updateStreak called");
  }
});

function checkResetStreak() {
  chrome.storage.local.get(['lastCompleted'], (data) => {
    const lastCompleted = new Date(data.lastCompleted ?? 0); // Returns Unix Epoch if item is null
    const now = new Date();
    const yesterday = now.getDate() - 1;

    if (lastCompleted.getDate() < yesterday) {
      chrome.storage.local.set({
        currentStreak: 0,
      });
    }
  });
}

// Initialize the storage
chrome.runtime.onInstalled.addListener(async () => {
  await updateStorage();
});

// Ensure the alarm is set when the extension starts
chrome.alarms.get('midnightAlarm', (alarm) => {
  if (!alarm) {
    // Find the time duration until midnight
    const currentTime = Date.now();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - currentTime;
    console.log(msUntilMidnight);
    //Create an alarm to update the storage every 24 hours at midnight
    chrome.alarms.create('midnightAlarm', {
      // When means the time the alarm will fire, so in this case it will fire at midnight
      when: Date.now() + msUntilMidnight,
      // Period means the time between each alarm firing, so in this case it will fire every 24 hours after the first midnight alarm
      periodInMinutes: 24 * 60,
    });
  }
});

// Update the storage and check if streak should be reset when the alarm is fired
chrome.alarms.onAlarm.addListener(async () => {
  updateStorage();
  checkResetStreak();
});

chrome.runtime.onMessage.addListener(onMessageReceived);
chrome.webRequest.onCompleted.addListener(checkIfUserSolvedProblem, {
  urls: ['*://leetcode.com/submissions/detail/*/check/'],
});
