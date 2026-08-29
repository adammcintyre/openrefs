import { Navigate, Route, Routes } from "react-router";

import { ComingSoon } from "../components/coming-soon";
import { AppLayout } from "./app-layout";
import { Landing } from "./landing";
import { Login } from "./login";
import { NAV_ITEMS } from "./nav";
import { Register } from "./register";

/**
 * Every module route is generated from NAV_ITEMS so the sidebar and the router
 * cannot drift apart. As a feature ships, lift its entry out of the map and
 * give it a real element.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* TODO(auth): wrap this branch in a session guard that redirects to
          /login once authentication exists. */}
      <Route path="/app" element={<AppLayout />}>
        {NAV_ITEMS.map((item) => {
          const element = (
            <ComingSoon
              title={item.label}
              description={item.description}
              phase={item.phase}
            />
          );
          return item.segment === "" ? (
            <Route key="index" index element={element} />
          ) : (
            <Route key={item.segment} path={item.segment} element={element} />
          );
        })}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
