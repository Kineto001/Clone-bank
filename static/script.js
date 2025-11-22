document.addEventListener('DOMContentLoaded', () => {
    // --- STATE VARIABLES ---
    let appState = {
        structure: null,
        currentUiStep: 'step-mode-selection',
        currentTestMode: null,
        selectedSubject: null,
        selectedUnit: null,
        selectedTopic: null,
        testQuestions: [],
        userAnswers: [],
        currentQuestionIndex: 0,
        currentReviewIndex: 0,
        currentTopicPage: 0,
        timerInterval: null,
        isPaused: false,
        testStartTime: 0,  // New: Track when test starts
        testEndTime: 0     // New: Track when test ends
    };
    const TOPICS_PER_PAGE = 8;
    
    // Reduced estimated time since we switched to a faster model
    const estimatedTimePerQuestion = 4; 

    // --- DOM ELEMENTS ---
    const selectionScreen = document.getElementById('selection-screen');
    const testScreen = document.getElementById('test-screen');
    const resultsScreen = document.getElementById('results-screen');
    const chatContainer = document.getElementById('chat-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const loadingTimerEl = document.getElementById('loading-timer'); // New Element
    const progressBar = document.getElementById('progress-bar');
    const pauseBtn = document.getElementById('pause-btn');
    const pauseIndicator = document.getElementById('pause-indicator');

    const uiSteps = {
        'step-mode-selection': document.getElementById('step-mode-selection'),
        'step-subject': document.getElementById('step-subject'),
        'step-topic': document.getElementById('step-topic'),
        'step-config': document.getElementById('step-config')
    };

    // --- UTILITY ---
    async function handleApiResponse(response) {
        if (!response.ok) {
            let errorMsg;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                errorMsg = errorData.error || JSON.stringify(errorData);
            } else {
                errorMsg = await response.text();
            }
            throw new Error(errorMsg);
        }
        return response.json();
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // --- INITIALIZATION ---
    function initializeApp() {
        fetchStructure();
        addInitialEventListeners();
        navigateToStep('step-mode-selection');
    }

    async function fetchStructure() {
        try {
            const response = await fetch('/api/get-structure');
            appState.structure = await handleApiResponse(response);
        } catch (error) {
            console.error('Error fetching structure:', error);
            document.getElementById('dynamic-selection-area').innerHTML = `<p class="error">Could not load test structure: ${error.message}</p>`;
        }
    }

    function addInitialEventListeners() {
        document.getElementById('topic-wise-btn').addEventListener('click', () => {
            appState.currentTestMode = 'topic-wise';
            navigateToStep('step-subject');
        });
        document.getElementById('quant-mock-btn').addEventListener('click', () => handleMockSelection('Quantitative Aptitude'));
        document.getElementById('reasoning-mock-btn').addEventListener('click', () => handleMockSelection('Reasoning Ability'));
        document.getElementById('english-mock-btn').addEventListener('click', () => handleMockSelection('English Language'));

        document.querySelectorAll('.subject-btn').forEach(button => {
            button.addEventListener('click', () => handleSubjectSelection(button.dataset.subject));
        });
        document.querySelectorAll('.back-btn').forEach(button => {
            button.addEventListener('click', () => {
                if(appState.currentUiStep === 'step-config') {
                    appState.currentTestMode = null;
                }
                navigateToStep(button.dataset.target)
            });
        });

        document.getElementById('start-test-btn').addEventListener('click', startTest);
        document.getElementById('next-btn').addEventListener('click', showNextQuestion);
        document.getElementById('prev-btn').addEventListener('click', showPrevQuestion);
        document.getElementById('submit-btn').addEventListener('click', confirmAndSubmitTest);
        document.getElementById('restart-btn').addEventListener('click', () => location.reload());
        document.getElementById('pause-btn').addEventListener('click', togglePauseTimer);

        document.getElementById('next-review-btn').addEventListener('click', showNextReviewQuestion);
        document.getElementById('prev-review-btn').addEventListener('click', showPrevReviewQuestion);

        document.getElementById('chat-toggle-btn').addEventListener('click', toggleChatWindow);
        document.getElementById('chat-close-btn').addEventListener('click', toggleChatWindow);
        document.getElementById('chat-send-btn').addEventListener('click', handleChatSubmit);
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleChatSubmit();
        });
    }

    function navigateToStep(stepId) {
        Object.values(uiSteps).forEach(step => step.classList.add('hidden'));
        if (uiSteps[stepId]) {
            uiSteps[stepId].classList.remove('hidden');
            appState.currentUiStep = stepId;
        }
    }
    
    function handleMockSelection(subject) {
        appState.currentTestMode = 'mock';
        appState.selectedSubject = subject;
        displayConfig();
    }

    function handleSubjectSelection(subject) {
        appState.selectedSubject = subject;
        const units = appState.structure[subject] ? Object.keys(appState.structure[subject]) : [];
        if (units.length > 0) {
            displayTopics(subject, units[0]);
        } else {
            const dynamicArea = document.getElementById('dynamic-selection-area');
            dynamicArea.innerHTML = `<p class="error">No topic files found for ${subject}.</p>`;
            navigateToStep('step-topic');
        }
    }

    function displayTopics(subject, unit) {
        appState.selectedUnit = unit;
        appState.currentTopicPage = 0;
        renderCurrentTopicsPage();
        navigateToStep('step-topic');
    }

    function renderCurrentTopicsPage() {
        const allTopics = appState.structure[appState.selectedSubject][appState.selectedUnit] || [];
        const dynamicArea = document.getElementById('dynamic-selection-area');
        
        if (allTopics.length === 0) {
            dynamicArea.innerHTML = `<p class="error">No topics found.</p>`;
            return;
        }

        const startIndex = appState.currentTopicPage * TOPICS_PER_PAGE;
        const endIndex = startIndex + TOPICS_PER_PAGE;
        const pageTopics = allTopics.slice(startIndex, endIndex);

        document.getElementById('topic-selection-header').textContent = `Step 2: Select a Topic for ${appState.selectedSubject}`;
        
        let html = '';
        pageTopics.forEach(topic => { html += `<button class="topic-btn" data-topic="${topic}">${topic.replace(/_/g, ' ')}</button>`; });

        const showPrev = appState.currentTopicPage > 0;
        const showNext = endIndex < allTopics.length;

        html += `<div class="pagination-controls">`;
        if (showPrev) html += `<button id="prev-topics-btn">Previous</button>`; else html += `<div></div>`;
        if (showNext) html += `<button id="next-topics-btn">Next</button>`; else html += `<div></div>`;
        html += `</div>`;

        dynamicArea.innerHTML = html;

        document.querySelectorAll('.topic-btn').forEach(button => {
            button.addEventListener('click', () => {
                appState.selectedTopic = button.dataset.topic;
                displayConfig();
            });
        });

        if (showPrev) document.getElementById('prev-topics-btn').addEventListener('click', () => { appState.currentTopicPage--; renderCurrentTopicsPage(); });
        if (showNext) document.getElementById('next-topics-btn').addEventListener('click', () => { appState.currentTopicPage++; renderCurrentTopicsPage(); });
    }

    function displayConfig() {
        const backBtn = uiSteps['step-config'].querySelector('.back-btn');
        const configTitle = document.getElementById('config-title');
        const numQuestionsSelect = document.getElementById('num-questions');
        const testDurationSelect = document.getElementById('test-duration');

        numQuestionsSelect.innerHTML = '';
        testDurationSelect.innerHTML = '';

        if (appState.currentTestMode === 'mock') {
            configTitle.textContent = `Configure ${appState.selectedSubject} Mock`;
            backBtn.textContent = 'Back to Mode Selection';
            backBtn.dataset.target = 'step-mode-selection';
            numQuestionsSelect.innerHTML = `<option value="10" selected>10</option><option value="15">15</option><option value="20">20</option>`;
            testDurationSelect.innerHTML = `<option value="10">10</option><option value="15" selected>15</option><option value="20">20</option>`;
        } else {
            configTitle.textContent = 'Step 3: Configure Your Test';
            backBtn.textContent = 'Back to Topics';
            backBtn.dataset.target = 'step-topic';
            numQuestionsSelect.innerHTML = `<option value="5">5</option><option value="10" selected>10</option><option value="15">15</option>`;
            testDurationSelect.innerHTML = `<option value="5">5</option><option value="10" selected>10</option><option value="15">15</option>`;
        }
        navigateToStep('step-config');
    }

    // --- GENERATION & TIMER LOGIC ---

    function startLoadingTimer(estimatedTotalSeconds) {
        let remaining = estimatedTotalSeconds;
        loadingTimerEl.textContent = `Estimated Time Remaining: ${formatTime(remaining)}`;
        
        return setInterval(() => {
            remaining--;
            if (remaining >= 0) {
                loadingTimerEl.textContent = `Estimated Time Remaining: ${formatTime(remaining)}`;
            } else {
                loadingTimerEl.textContent = `Finishing up...`;
            }
        }, 1000);
    }

    async function startTest() {
        const numQuestions = parseInt(document.getElementById('num-questions').value, 10);
        const duration = parseInt(document.getElementById('test-duration').value, 10);
    
        loadingIndicator.classList.remove('hidden');
        Object.values(uiSteps).forEach(step => step.classList.add('hidden'));
        progressBar.style.width = '0%';

        if (appState.currentTestMode === 'mock') {
            await generateSubjectMockTest(appState.selectedSubject, numQuestions, duration);
        } else {
            await startTopicWiseTest(numQuestions, duration);
        }
    }

    async function startTopicWiseTest(numQuestions, duration) {
        const estimatedTotalTime = Math.ceil(estimatedTimePerQuestion * numQuestions);
        loadingText.textContent = `Generating ${numQuestions} questions for "${appState.selectedTopic.replace(/_/g, ' ')}"...`;
        
        // Start Reverse Timer
        const countdownInterval = startLoadingTimer(estimatedTotalTime);

        // Progress Bar Simulation
        let progressTimer;
        let currentInterval = 0;
        const intervalTime = 100; 
        const totalIntervals = estimatedTotalTime * 1000 / intervalTime;

        progressTimer = setInterval(() => {
            if (currentInterval < totalIntervals) {
                currentInterval++;
                const progress = (currentInterval / totalIntervals) * 95; 
                progressBar.style.width = `${progress}%`; 
            }
        }, intervalTime);

        const params = {
            subject: appState.selectedSubject,
            unit: appState.selectedUnit,
            topic: appState.selectedTopic,
            num_questions: numQuestions,
            test_type: 'topic-wise'
        };

        try {
            const response = await fetch('/api/generate-test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
            });
            appState.testQuestions = await handleApiResponse(response);
            
            clearInterval(countdownInterval); // Stop timer
            clearInterval(progressTimer); // Stop progress bar
            progressBar.style.width = '100%';
            
            renderTest(duration * 60, `${appState.selectedTopic.replace(/_/g, ' ')} Test`);
        } catch (error) {
            clearInterval(countdownInterval);
            clearInterval(progressTimer);
            console.error('Error starting test:', error);
            alert(`Error: ${error.message}`);
            location.reload();
        }
    }

    async function generateSubjectMockTest(subject, totalQuestions, durationMinutes) {
        appState.testQuestions = [];
        const subjectData = appState.structure[subject];
        const unitKey = Object.keys(subjectData)[0];
        const topics = subjectData[unitKey];
        const questionsPerTopic = Math.max(1, Math.ceil(totalQuestions / topics.length));
        
        const estimatedTotalTime = Math.ceil(topics.length * estimatedTimePerQuestion);
        
        // Start Reverse Timer
        const countdownInterval = startLoadingTimer(estimatedTotalTime);

        loadingText.textContent = `Building Mock Test...`;
        
        // Progress bar simulation
        let mockProgressTimer;
        let currentInterval = 0;
        const intervalTime = 200;
        const totalIntervals = estimatedTotalTime * 1000 / intervalTime;

        mockProgressTimer = setInterval(() => {
            if (currentInterval < totalIntervals) {
                currentInterval++;
                const progress = (currentInterval / totalIntervals) * 95;
                progressBar.style.width = `${progress}%`;
            }
        }, intervalTime);

        for (const topic of topics) {
            try {
                const response = await fetch('/api/generate-test', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subject: subject, topic: topic, unit: unitKey,
                        num_questions: questionsPerTopic, test_type: 'mock'
                    }),
                });
                const newQuestions = await handleApiResponse(response);
                if (newQuestions) appState.testQuestions.push(...newQuestions);
            } catch (error) {
                console.warn(`Error generating for ${topic}, skipping.`);
            }
        }
        
        clearInterval(countdownInterval);
        clearInterval(mockProgressTimer);
        progressBar.style.width = '100%';
    
        appState.testQuestions = appState.testQuestions.sort(() => 0.5 - Math.random()).slice(0, totalQuestions);
        renderTest(durationMinutes * 60, `${subject} Mock Test`);
        loadingIndicator.classList.add('hidden');
    }

    function renderTest(durationInSeconds, testTitle) {
        selectionScreen.classList.add('hidden');
        testScreen.classList.remove('hidden');
        chatContainer.classList.remove('hidden');
        document.getElementById('test-title').textContent = testTitle;
        loadingIndicator.classList.add('hidden');

        appState.userAnswers = new Array(appState.testQuestions.length).fill(null);
        
        // START TEST TIMER
        appState.testStartTime = Date.now();
        startTimer(durationInSeconds);
        
        buildQuestionPalette();
        displayQuestion(0);
    }

    function displayQuestion(index) {
        if(appState.isPaused) return;
        appState.currentQuestionIndex = index;
        const question = appState.testQuestions[index];
        document.getElementById('question-number').textContent = `Question ${index + 1} of ${appState.testQuestions.length}`;
        document.getElementById('question-text').textContent = question.question;
        const optionsContainer = document.getElementById('options-container');
        optionsContainer.innerHTML = '';
        question.options.forEach((option, i) => {
            const optionEl = document.createElement('div');
            optionEl.className = 'option';
            optionEl.textContent = option;
            if (appState.userAnswers[index] === i) optionEl.classList.add('selected');
            optionEl.addEventListener('click', () => selectOption(i));
            optionsContainer.appendChild(optionEl);
        });
        updateNavButtons();
        updatePaletteHighlight();
    }

    function selectOption(optionIndex) {
        if(appState.isPaused) return;
        const oldAnswer = appState.userAnswers[appState.currentQuestionIndex];
        appState.userAnswers[appState.currentQuestionIndex] = optionIndex;
        document.querySelectorAll('.palette-btn')[appState.currentQuestionIndex].classList.add('answered');
        if(oldAnswer === null){ 
            setTimeout(() => {
                if (appState.currentQuestionIndex < appState.testQuestions.length - 1) showNextQuestion();
            }, 300);
        }
        displayQuestion(appState.currentQuestionIndex);
    }

    function showNextQuestion() { if (appState.currentQuestionIndex < appState.testQuestions.length - 1) displayQuestion(appState.currentQuestionIndex + 1); }
    function showPrevQuestion() { if (appState.currentQuestionIndex > 0) displayQuestion(appState.currentQuestionIndex - 1); }

    function updateNavButtons() {
        document.getElementById('prev-btn').disabled = appState.currentQuestionIndex === 0;
        document.getElementById('next-btn').disabled = appState.currentQuestionIndex === appState.testQuestions.length - 1;
    }

    function buildQuestionPalette() {
        const palette = document.getElementById('question-palette');
        palette.innerHTML = '';
        appState.testQuestions.forEach((_, index) => {
            const btn = document.createElement('button');
            btn.textContent = index + 1;
            btn.className = 'palette-btn';
            btn.addEventListener('click', () => displayQuestion(index));
            palette.appendChild(btn);
        });
    }

    function updatePaletteHighlight() {
        document.querySelectorAll('.palette-btn').forEach((btn, index) => {
            btn.classList.remove('current', 'answered');
            if (appState.userAnswers[index] !== null) btn.classList.add('answered');
            if (index === appState.currentQuestionIndex) btn.classList.add('current');
        });
    }

    function startTimer(duration) {
        let timer = duration;
        const timerEl = document.getElementById('timer');
        if (appState.timerInterval) clearInterval(appState.timerInterval);

        appState.timerInterval = setInterval(() => {
            if (appState.isPaused) return;
            
            // Update Timer UI
            let minutes = parseInt(timer / 60, 10);
            let seconds = parseInt(timer % 60, 10);
            minutes = minutes < 10 ? "0" + minutes : minutes;
            seconds = seconds < 10 ? "0" + seconds : seconds;
            timerEl.textContent = `${minutes}:${seconds}`;

            if (--timer < 0) {
                clearInterval(appState.timerInterval);
                alert("Time's up!");
                submitTest();
            }
        }, 1000);
    }

    function togglePauseTimer() {
        appState.isPaused = !appState.isPaused;
        if (appState.isPaused) {
            pauseBtn.textContent = 'Resume';
            pauseBtn.classList.add('resume-active');
            testScreen.classList.add('test-paused');
            pauseIndicator.classList.remove('hidden');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.classList.remove('resume-active');
            testScreen.classList.remove('test-paused');
            pauseIndicator.classList.add('hidden');
        }
    }

    function confirmAndSubmitTest() {
        const unanswered = appState.userAnswers.filter(a => a === null).length;
        const msg = unanswered > 0 
            ? `You have ${unanswered} unanswered questions. Submit?` 
            : `Are you sure you want to submit the test?`;
        if (confirm(msg)) submitTest();
    }

    function submitTest() {
        clearInterval(appState.timerInterval);
        appState.testEndTime = Date.now(); // Capture End Time
        chatContainer.classList.add('hidden');
        calculateAndShowResults();
    }

    function calculateAndShowResults() {
        let score = 0;
        appState.testQuestions.forEach((q, i) => {
            if (appState.userAnswers[i] === q.correct_answer_index) score++;
        });

        // Calculate Time Taken
        const timeTakenSeconds = Math.floor((appState.testEndTime - appState.testStartTime) / 1000);
        const timeString = formatTime(timeTakenSeconds);

        testScreen.classList.add('hidden');
        resultsScreen.classList.remove('hidden');
        
        // Updated Results HTML with Time Taken
        const scoreSummary = document.getElementById('score-summary');
        scoreSummary.innerHTML = `
            <p>You scored <strong>${score}</strong> out of <strong>${appState.testQuestions.length}</strong>.</p>
            <p>Percentage: <strong>${((score / appState.testQuestions.length) * 100).toFixed(2)}%</strong></p>
            <p style="color: #555; font-size: 1rem; margin-top: 0.5rem;">Time Taken: <strong>${timeString}</strong></p>
        `;
        
        appState.currentReviewIndex = 0;
        displayReviewQuestion(appState.currentReviewIndex);
    }

    function displayReviewQuestion(index) {
        const question = appState.testQuestions[index];
        const userAnswer = appState.userAnswers[index];
        document.getElementById('review-question-number').textContent = `Reviewing Question ${index + 1} of ${appState.testQuestions.length}`;
        document.getElementById('review-question-text').textContent = question.question;
        document.getElementById('review-explanation-text').textContent = question.explanation;
        const reviewOptionsContainer = document.getElementById('review-options-container');
        reviewOptionsContainer.innerHTML = '';
        question.options.forEach((optionText, optIndex) => {
            const optionEl = document.createElement('div');
            optionEl.className = 'option';
            optionEl.textContent = optionText;
            if (optIndex === question.correct_answer_index) {
                optionEl.classList.add('review-correct');
            } else if (optIndex === userAnswer) {
                optionEl.classList.add('review-incorrect');
            } else {
                optionEl.classList.add('review-neutral');
            }
            reviewOptionsContainer.appendChild(optionEl);
        });
        document.getElementById('prev-review-btn').disabled = index === 0;
        document.getElementById('next-review-btn').disabled = index === appState.testQuestions.length - 1;
    }

    function showNextReviewQuestion() {
        if (appState.currentReviewIndex < appState.testQuestions.length - 1) {
            appState.currentReviewIndex++;
            displayReviewQuestion(appState.currentReviewIndex);
        }
    }

    function showPrevReviewQuestion() {
        if (appState.currentReviewIndex > 0) {
            appState.currentReviewIndex--;
            displayReviewQuestion(appState.currentReviewIndex);
        }
    }

    function toggleChatWindow() { document.getElementById('chat-window').classList.toggle('hidden'); }

    async function handleChatSubmit() {
        const input = document.getElementById('chat-input');
        const userQuery = input.value.trim();
        if (!userQuery) return;
        addMessageToChat('user', userQuery);
        input.value = '';
        addMessageToChat('ai', 'VidhAI is thinking...');
        try {
            const currentQuestion = appState.testQuestions[appState.currentQuestionIndex];
            const response = await fetch('/api/chat-support', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_query: userQuery,
                    question_text: currentQuestion.question,
                    topic: currentQuestion.topic
                })
            });
            const data = await handleApiResponse(response);
            const messagesContainer = document.getElementById('chat-messages');
            messagesContainer.removeChild(messagesContainer.lastChild);
            addMessageToChat('ai', data.reply);
        } catch (error) {
            const messagesContainer = document.getElementById('chat-messages');
            messagesContainer.removeChild(messagesContainer.lastChild);
            addMessageToChat('ai', 'Error getting hint.');
        }
    }

    function addMessageToChat(sender, text) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${sender}-message`;
        messageEl.textContent = text;
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    initializeApp();
});