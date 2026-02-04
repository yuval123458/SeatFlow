import { useParams } from "react-router-dom";
import AdminManualCorrectionScreen from "../components/AdminManualCorrectionScreen";

export default function AdminManualCorrectionPage() {
  const { eventId } = useParams();
  return <AdminManualCorrectionScreen eventId={eventId} />;
}
