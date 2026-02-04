import { useParams } from "react-router-dom";
import EventDetailsScreen from "../components/EventDetailsScreen";

export default function EventDetailsSinglePage() {
  const { eventId } = useParams();
  return <EventDetailsScreen eventId={eventId} />;
}
