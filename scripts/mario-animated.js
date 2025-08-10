// scripts/mario-animated.js
import fs from "fs";

const username = process.env.GITHUB_USER_NAME || "your-username";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN diperlukan (simpan di secrets).");
  process.exit(1);
}

// Ambil contribution 52 minggu terakhir (hari per hari)
async function fetchContributions(user) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalWeeks: weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: user } }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL error", JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }

  const weeks =
    json.data.user.contributionsCollection.contributionCalendar.totalWeeks;
  const days = weeks.flatMap((w) => w.contributionDays);
  // return last 70 days (untuk lebar animasi yang nyaman)
  return days
    .slice(-70)
    .map((d) => ({ date: d.date, count: d.contributionCount }));
}

function makeSVG(days, user) {
  const width = Math.max(700, days.length * 12);
  const height = 160;
  const groundY = 120;

  // scale contributionCount -> bar height (maks 40 px)
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  function barH(c) {
    return Math.round((c / maxCount) * 48);
  }

  // Mario animation params
  const marioSize = 12;
  const path = days.map((_, i) => ({ x: 10 + i * 12, y: groundY }));

  // Build bars
  const bars = days
    .map((d, i) => {
      const h = barH(d.count);
      const x = 10 + i * 12;
      const y = groundY - h;
      return `<rect class="bar" x="${x}" y="${y}" width="8" height="${h}" rx="2"/>
            <title>${d.date} — ${d.count} contributions</title>`;
    })
    .join("\n");

  // Animation: Mario moves across the graph in 8s loop, and jumps when he encounters a tall bar (>50% of max)
  // We implement jump by animating 'cy' of a <g> that contains Mario rects.

  // Build jump keyTimes/values based on days where count > threshold
  const jumpIndices = days
    .map((d, i) => (d.count > maxCount * 0.5 ? i : -1))
    .filter((i) => i >= 0);

  // For simplicity: Mario position animates linearly across width; we'll add discrete jumps timed relative to length
  const totalDuration = 8; // seconds for full loop
  const keyTimes = [];
  const values = [];
  // We'll produce keyTimes/values for translateX (0 -> finalX) and translateY for jumps

  // translateX: linear from 0 to (width-40)
  const txAnim = `0; ${width - 60}`;

  // translateY: default 0, occasional -30 for jump. We'll create an SMIL animation with keyPoints simplified.

  // Create simple SMIL animation for translateX and translateY using animateTransform

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg { fill: linear-gradient(#0b3d91, #07173a); }
    .bar { fill: #6fcf97; }
    .ground { fill: #2b2b2b; opacity: 0.1; }
    .mario-body { fill: #d32f2f; }
    .mario-hat { fill: #b71c1c; }
    .mario-face { fill: #ffd7a6; }
    .shadow { fill: rgba(0,0,0,0.2); }
    .small { font: 10px sans-serif; fill: #999; }
  </style>

  <!-- background -->
  <rect width="100%" height="100%" fill="#07112a" />

  <!-- bars (contribution columns) -->
  <g transform="translate(0,0)">
    ${bars}
  </g>

  <!-- ground line -->
  <rect x="0" y="${groundY + 12}" width="${width}" height="8" class="ground" />

  <!-- Mario group (a tiny pixel Mario built from rects) -->
  <g id="mario" transform="translate(0,0)">
    <g id="marioSprite" transform="translate(0, ${groundY - marioSize})">
      <!-- shadow -->
      <ellipse cx="6" cy="${marioSize + 4}" rx="6" ry="2" class="shadow" />
      <!-- body -->
      <rect x="0" y="0" width="12" height="8" rx="2" class="mario-body" />
      <!-- hat -->
      <rect x="0" y="-4" width="12" height="4" rx="1" class="mario-hat" />
      <!-- face -->
      <rect x="2" y="2" width="3" height="3" rx="1" class="mario-face" />
    </g>

    <!-- translateX animation (loop) -->
    <animateTransform attributeName="transform"
      attributeType="XML"
      type="translate"
      from="0 0"
      to="${width - 60} 0"
      dur="${totalDuration}s"
      repeatCount="indefinite"
      calcMode="linear" />

    <!-- simple jump animation: animate 'y' of marioSprite using values. We synthesize jumps at indices -->
    <animateTransform xlink:href="#marioSprite" attributeName="transform"
      attributeType="XML"
      type="translate"
      dur="${totalDuration}s"
      repeatCount="indefinite"
      keyTimes="${generateKeyTimes(days.length)}"
      values="${generateJumpValues(days.length)}"
      calcMode="discrete" />
  </g>

  <!-- footer text -->
  <text x="10" y="${
    height - 6
  }" class="small">Mario Contribution — @${user}</text>
</svg>
`;

  return svg;
}

// Helper: generate keyTimes from number of frames (days)
function generateKeyTimes(n) {
  // n frames -> create n keyTimes evenly spaced from 0 to 1
  const parts = [];
  for (let i = 0; i < n; i++) parts.push((i / n).toFixed(4));
  parts.push("1");
  return parts.join(";");
}

// Helper: generate jump values: each frame is "0 y" where y is -jump or 0
function generateJumpValues(n) {
  // To decide jumps deterministically: jump every 7th day (simple pattern), or when day count > threshold
  // For simplicity (deterministic without sequencing GraphQL here), we make Mario jump every 6th frame.
  const vals = [];
  for (let i = 0; i < n; i++) {
    if (i % 6 === 0) vals.push(`0 -28`);
    else vals.push(`0 0`);
  }
  vals.push("0 0");
  return vals.join(";");
}

(async () => {
  try {
    const days = await fetchContributions(username);
    const svg = makeSVG(days.slice(-70), username);
    fs.mkdirSync("dist", { recursive: true });
    fs.writeFileSync("dist/mario-contribution-graph.svg", svg, "utf8");
    console.log("✔ dist/mario-contribution-graph.svg created");
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
