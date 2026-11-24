// Destination registry. kind: "files" (the rendered folder), "todo" (tasks in a to-do app), "event" (webhook).
import { folder, rclone, webdav, gdrive, onedrive, dropbox, git } from "./files.js";
import { webhook, server } from "./webhook.js";
import { todoist, googleTasks, microsoftTodo, ticktick, notion, caldav, appleReminders, things } from "./todoapps.js";

export const DESTINATIONS = {
  folder, rclone, webdav, gdrive, onedrive, dropbox, git,
  webhook, server,
  todoist, "google-tasks": googleTasks, "microsoft-todo": microsoftTodo, ticktick, notion, caldav, "apple-reminders": appleReminders, things,
};
