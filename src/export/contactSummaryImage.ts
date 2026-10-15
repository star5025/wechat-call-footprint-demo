import type { ContactCallSummary } from "@/data/contactSummary";
import { formatCompactDuration, formatDate } from "@/utils/format";

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT = '"Segoe UI Variable", "Microsoft YaHei UI", sans-serif';
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string | CanvasGradient
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  color: string,
  align: CanvasTextAlign = "left",
  maxWidth?: number,
  minSize = 20
) {
  let fittedSize = size;
  context.font = `${weight} ${fittedSize}px ${FONT}`;
  while (maxWidth && fittedSize > minSize && context.measureText(text).width > maxWidth) {
    fittedSize -= 2;
    context.font = `${weight} ${fittedSize}px ${FONT}`;
  }
  let fittedText = text;
  const characters = Array.from(text);
  while (maxWidth && characters.length > 1 && context.measureText(fittedText).width > maxWidth) {
    characters.pop();
    fittedText = `${characters.join("")}…`;
  }
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(fittedText, x, y);
}

async function loadImage(source?: string | null): Promise<HTMLImageElement | null> {
  if (!source || (!source.startsWith("data:") && !source.startsWith("blob:"))) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function drawAvatar(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  label: string,
  x: number,
  y: number,
  size: number,
  from: string,
  to: string
) {
  context.save();
  context.shadowColor = "rgba(76,58,118,.2)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 14;
  fillRoundedRect(context, x, y, size, size, 48, "rgba(255,255,255,.94)");
  context.restore();

  context.save();
  roundedRect(context, x + 8, y + 8, size - 16, size - 16, 41);
  context.clip();
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    context.drawImage(image, sourceX, sourceY, side, side, x + 8, y + 8, size - 16, size - 16);
  } else {
    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    context.fillStyle = gradient;
    context.fillRect(x + 8, y + 8, size - 16, size - 16);
    drawText(
      context,
      label.slice(0, 1) || "?",
      x + size / 2,
      y + size / 2 + 27,
      68,
      850,
      "#ffffff",
      "center"
    );
  }
  context.restore();
}

interface MetricCard {
  icon: string;
  label: string;
  value: string;
  from: string;
  to: string;
  valueSize?: number;
}

function drawMetricCard(
  context: CanvasRenderingContext2D,
  card: MetricCard,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, card.from);
  gradient.addColorStop(1, card.to);
  context.save();
  context.shadowColor = "rgba(67,50,96,.09)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 12;
  fillRoundedRect(context, x, y, width, height, 42, gradient);
  context.restore();

  context.font = `400 54px ${EMOJI_FONT}`;
  context.textAlign = "left";
  context.fillText(card.icon, x + 38, y + 78);
  drawText(context, card.label, x + 38, y + 140, 27, 750, "rgba(48,40,63,.62)", "left", width - 76);
  drawText(context, card.value, x + 38, y + 224, card.valueSize ?? 48, 880, "#312a40", "left", width - 76, 25);
}

const compactDuration = (seconds: number) =>
  seconds < 60 ? `${seconds} 秒` : formatCompactDuration(seconds);

const safeFilePart = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 40) || "联系人";

export function contactSummaryFileName(summary: ContactCallSummary): string {
  return `${safeFilePart(summary.contact.displayName)}-通话总结.png`;
}

export async function createContactSummaryPng(summary: ContactCallSummary): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成图片。");

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#fbfaf8");
  background.addColorStop(.48, "#f4f0ff");
  background.addColorStop(1, "#fff0e9");
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.globalAlpha = .3;
  context.fillStyle = "#d6c7ff";
  context.beginPath();
  context.arc(70, 340, 255, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffd5c5";
  context.beginPath();
  context.arc(1040, 780, 340, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  fillRoundedRect(context, 74, 68, 82, 82, 28, "#8069d1");
  context.font = `400 43px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("📞", 115, 126);
  drawText(context, "通话足迹", 178, 124, 32, 880, "#292435");

  const [accountAvatar, contactAvatar] = await Promise.all([
    loadImage(summary.account.avatarRef),
    loadImage(summary.contact.avatarRef)
  ]);
  drawAvatar(context, accountAvatar, summary.account.displayName, 250, 220, 190, "#8b74d8", "#b294e9");
  drawAvatar(context, contactAvatar, summary.contact.displayName, 640, 220, 190, "#f0a6b8", "#d985ad");

  const connection = context.createLinearGradient(442, 0, 638, 0);
  connection.addColorStop(0, "#9b87df");
  connection.addColorStop(1, "#df94b1");
  context.strokeStyle = connection;
  context.lineWidth = 7;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(472, 315);
  context.lineTo(608, 315);
  context.stroke();
  fillRoundedRect(context, 506, 281, 68, 68, 25, "#ffffff");
  context.font = `400 34px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("💜", 540, 327);

  drawText(context, summary.account.displayName, 345, 462, 29, 820, "#4c4458", "center", 300, 22);
  drawText(context, summary.contact.displayName, 735, 462, 29, 820, "#4c4458", "center", 300, 22);
  drawText(context, "我们的通话足迹", WIDTH / 2, 570, 58, 920, "#292435", "center", 880, 34);

  const heroGradient = context.createLinearGradient(74, 650, 1006, 980);
  heroGradient.addColorStop(0, "#7862c8");
  heroGradient.addColorStop(.52, "#9a7ddd");
  heroGradient.addColorStop(1, "#e497b4");
  context.save();
  context.shadowColor = "rgba(105,78,167,.24)";
  context.shadowBlur = 42;
  context.shadowOffsetY = 19;
  fillRoundedRect(context, 74, 650, 932, 330, 54, heroGradient);
  context.restore();

  const durationLabel = summary.durationComplete ? "通话总时长" : "已知通话时长";
  const durationValue = summary.timedCount > 0
    ? compactDuration(summary.totalDurationSeconds)
    : summary.connectedCount > 0 ? "时长未知" : "0 分钟";
  drawText(context, durationLabel, 132, 760, 31, 780, "rgba(255,255,255,.8)");
  drawText(context, durationValue, 132, 886, 72, 920, "#ffffff", "left", 690, 40);
  context.font = `400 92px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("💬", 865, 855);

  const longestDate = !summary.durationComplete || !summary.timeInsightsComplete
    ? "暂无法判断"
    : summary.longestCallDurationSeconds === null
      ? "暂无"
      : summary.longestCallDate ? formatDate(summary.longestCallDate) : "日期未知";
  const streakValue = summary.timeInsightsComplete
    ? `${summary.longestStreakDays} 天`
    : "暂无法判断";
  const favorite = summary.favoritePeriod;
  const cards: MetricCard[] = [
    { icon: "📅", label: "最长通话日期", value: longestDate, from: "#eee9ff", to: "#ded4ff", valueSize: 43 },
    { icon: "🔥", label: "最长连续通话", value: streakValue, from: "#fff0e7", to: "#ffd9ca" },
    { icon: "🕘", label: "最常通话时段", value: favorite?.label ?? "暂无法判断", from: "#e5f7f0", to: "#ccefe3", valueSize: 44 },
    { icon: "📞", label: "接通次数", value: `${summary.connectedCount} 次`, from: "#e8f3fc", to: "#d7eafe" }
  ];
  const positions = [[74, 1050], [558, 1050], [74, 1370], [558, 1370]];
  cards.forEach((card, index) => {
    const [x, y] = positions[index];
    drawMetricCard(context, card, x, y, 448, 280);
  });

  const ending = context.createLinearGradient(260, 0, 820, 0);
  ending.addColorStop(0, "rgba(126,101,203,0)");
  ending.addColorStop(.5, "rgba(126,101,203,.42)");
  ending.addColorStop(1, "rgba(223,143,177,0)");
  context.fillStyle = ending;
  context.fillRect(260, 1785, 560, 4);
  context.font = `400 42px ${EMOJI_FONT}`;
  context.textAlign = "center";
  context.fillText("📞  ·  💜  ·  📞", WIDTH / 2, 1815);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("图片生成失败，请稍后重试。")),
      "image/png"
    );
  });
}
