const axios = require('axios');

function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[len1][len2];
}

function similarityScore(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    const distance = levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);

    return 1 - (distance / maxLen);
}

function partialMatch(searchTerm, targetTitle) {
    const search = searchTerm.toLowerCase().trim();
    const target = targetTitle.toLowerCase().trim();

    if (target.includes(search)) return 1.0;
    if (search.includes(target)) return 0.9;

    const searchWords = search.split(/\s+/);
    const targetWords = target.split(/\s+/);

    let matchedWords = 0;
    searchWords.forEach(sw => {
        if (targetWords.some(tw => tw.includes(sw) || sw.includes(tw))) {
            matchedWords++;
        }
    });

    return matchedWords / searchWords.length;
}

function bestMatch(searchTitle, results) {
    let bestResult = null;
    let bestScore = 0;

    console.log('\n=== Analyzing Results ===');
    console.log('Search Term:', searchTitle);
    console.log('');

    results.forEach((result, index) => {
        const title = result.name || result.title;

        const exactScore = similarityScore(searchTitle, title);
        const partialScore = partialMatch(searchTitle, title);

        const combinedScore = (exactScore * 0.6) + (partialScore * 0.4);

        console.log(`[${index}] ${title}`);
        console.log(`    Exact Match: ${(exactScore * 100).toFixed(1)}%`);
        console.log(`    Partial Match: ${(partialScore * 100).toFixed(1)}%`);
        console.log(`    Combined Score: ${(combinedScore * 100).toFixed(1)}%`);
        console.log('');

        if (combinedScore > bestScore) {
            bestScore = combinedScore;
            bestResult = result;
        }
    });

    return { result: bestResult, score: bestScore };
}

async function testCinemeta(searchTerm) {
    console.log('\n========================================');
    console.log('Testing Cinemeta Search');
    console.log('========================================');

    try {
        const response = await axios.get(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(searchTerm)}.json`);

        if (!response.data || !response.data.metas || response.data.metas.length === 0) {
            console.log('No results found');
            return;
        }

        const results = response.data.metas;
        console.log(`Found ${results.length} results from Cinemeta`);

        const { result: best, score } = bestMatch(searchTerm, results);

        console.log('=== BEST MATCH ===');
        console.log('Title:', best.name || best.title);
        console.log('IMDB ID:', best.imdb_id || best.id);
        console.log('Score:', (score * 100).toFixed(1) + '%');
        console.log('Year:', best.year || 'N/A');
        console.log('');

        console.log('=== CURRENT METHOD (First Result) ===');
        console.log('Title:', results[0].name || results[0].title);
        console.log('IMDB ID:', results[0].imdb_id || results[0].id);
        console.log('');

        if (best.id !== results[0].id) {
            console.log('⚠️  Different result! New algorithm found a better match.');
        } else {
            console.log('✓ Same result as current method.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function runTests() {
    const testCases = [
        "I Am a Running Mate",
        "Breaking Bad",
        "The Walking Dead",
        "Game of Thrones"
    ];

    for (const testCase of testCases) {
        await testCinemeta(testCase);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

runTests();
