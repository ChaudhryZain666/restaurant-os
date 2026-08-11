import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { AvailabilityBanner } from "./AvailabilityBanner";

export function Layout() {
  const { user, logout } = useAuth();
  const { lines } = useCart();
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <div>
      <nav style={{ display: "flex", gap: "1rem", padding: "1rem", borderBottom: "1px solid #ddd" }}>
        <Link to="/">Menu</Link>
        <Link to="/cart">Cart ({itemCount})</Link>
        {user && <Link to="/orders">Orders</Link>}
        {user && <Link to="/loyalty">Loyalty</Link>}
        <div style={{ marginLeft: "auto" }}>
          {user ? (
            <>
              <span>{user.name}</span>{" "}
              <button onClick={() => logout()}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link> <Link to="/register">Register</Link>
            </>
          )}
        </div>
      </nav>
      <AvailabilityBanner />
      <main style={{ padding: "1rem" }}>
        <Outlet />
      </main>
    </div>
  );
}
