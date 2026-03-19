export function validateBranchName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed === "." || trimmed === "..") {
    return "分支名不能是“.”或“..”。";
  }
  if (/\s/.test(trimmed)) {
    return "分支名不能包含空格。";
  }
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return "分支名不能以“/”开头或结尾。";
  }
  if (trimmed.includes("//")) {
    return "分支名不能包含“//”。";
  }
  if (trimmed.endsWith(".lock")) {
    return "分支名不能以“.lock”结尾。";
  }
  if (trimmed.includes("..")) {
    return "分支名不能包含“..”。";
  }
  if (trimmed.includes("@{")) {
    return "分支名不能包含“@{”。";
  }
  const invalidChars = ["~", "^", ":", "?", "*", "[", "\\"];
  if (invalidChars.some((char) => trimmed.includes(char))) {
    return "分支名包含非法字符。";
  }
  if (trimmed.endsWith(".")) {
    return "分支名不能以“.”结尾。";
  }
  return null;
}
