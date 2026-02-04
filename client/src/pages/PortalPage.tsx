import { useParams } from "react-router-dom";
import PortalScreen from "../components/PortalScreen";

export default function PortalPage() {
  const { token } = useParams();
  return <PortalScreen token={token} />;
}
