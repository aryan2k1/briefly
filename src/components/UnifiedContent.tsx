import { useState } from "react";
import type { Lookups } from "@/lib/contracts";
import {
  CalendarScreen,
  OverviewScreen,
  MeetingList,
  Connections,
  NotesSearch,
  firstWeek,
  type UnifiedProps,
} from "./UnifiedScreens";
import { MeetingScreen } from "./UnifiedMeeting";
import { BriefScreen } from "./UnifiedBrief";
import { ScreenHead, RouteLink } from "./UnifiedCommon";
import { MeetingForm } from "./RelationshipForms";
export default function UnifiedContent({
  route,
  lookups,
  lookupError,
  retryLookups,
  ...props
}: UnifiedProps & {
  route: string;
  lookups?: Lookups;
  lookupError?: string;
  retryLookups: () => void;
}) {
  const [week, setWeek] = useState(firstWeek);
  const [path, query = ""] = route.split("?");
  const filters = new URLSearchParams(query);
  const [page, id = ""] = path.split("/");
  if (page === "contacts") return null;
  if (page === "meetings" && id === "new") {
    if (props.session.membership.role === "viewer")
      return (
        <ScreenHead
          label="Meetings"
          title="Read-only access"
          text="Your role can view meetings but cannot create them."
        >
          <RouteLink to="meetings">View meetings</RouteLink>
        </ScreenHead>
      );
    if (!lookups)
      return lookupError ? (
        <div className="error" role="alert">
          <p>{lookupError}</p>
          <button onClick={retryLookups}>Retry reference data</button>
        </div>
      ) : (
        <p role="status">Loading meeting form…</p>
      );
    return (
      <>
        <ScreenHead
          label="Meetings"
          title="New meeting"
          text="Select a company and participants to create a meeting record."
        >
          <RouteLink to="meetings">View meetings</RouteLink>
        </ScreenHead>
        <MeetingForm
          lookups={lookups}
          session={props.session}
          onExpired={props.onExpired}
          onReload={retryLookups}
          onClose={() => {
            window.location.hash = "meetings";
          }}
          onSaved={() => {
            props.onChanged(
              "Meeting created. Open it from the meeting list or calendar.",
            );
            window.location.hash = "meetings";
          }}
        />
      </>
    );
  }
  if (page === "calendar" || page === "home")
    return <CalendarScreen {...props} week={week} setWeek={setWeek} />;
  if (page === "overview") return <OverviewScreen {...props} />;
  if (page === "meetings" || page === "briefings")
    return (
      <MeetingList
        key={route}
        {...props}
        briefings={page === "briefings"}
        initialStatus={filters.get("status") ?? ""}
        initialTag={filters.get("tag") ?? ""}
        initialScope={filters.get("scope") ?? ""}
      />
    );
  if (page === "connections") return <Connections {...props} />;
  if (page === "ask") return <NotesSearch {...props} />;
  if (page === "brief" && id)
    return <BriefScreen key={id} id={id} {...props} />;
  if (page === "meeting" && id)
    return lookups ? (
      <MeetingScreen key={id} id={id} lookups={lookups} {...props} />
    ) : lookupError ? (
      <div className="error" role="alert">
        <p>{lookupError}</p>
        <button className="secondary" onClick={retryLookups}>
          Retry meeting reference data
        </button>
      </div>
    ) : (
      <p className="empty" role="status">
        Loading meeting reference data…
      </p>
    );
  return (
    <ScreenHead
      label="Workspace"
      title="This page is unavailable."
      text="Choose a workspace page from the navigation menu."
    >
      <RouteLink to="calendar">Return to calendar</RouteLink>
    </ScreenHead>
  );
}
