package com.seatflow.solver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class SolverApplication {

    public static void main(String[] args) {
        SpringApplication.run(SolverApplication.class, args);
    }

    /** Runs N randomized seatings in parallel and returns the best-scoring one. */
    @PostMapping("/solve")
    public Solver.Result solve(@RequestBody Solver.Request request) {
        return Solver.solve(request);
    }
}
